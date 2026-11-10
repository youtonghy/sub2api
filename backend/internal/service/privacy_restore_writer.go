package service

import (
	"bytes"
	"net/http"
	"strconv"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/gin-gonic/gin"
)

const privacyRestoreWriterKey = "sub2api.privacy_filter.restore_writer"

type privacyWriterMode int

const (
	privacyWriterUndecided privacyWriterMode = iota
	privacyWriterPassthrough
	privacyWriterSSE
	privacyWriterJSON
)

// privacyRestoreWriter sits between the gateway and the client and restores
// placeholders in what is written, after any protocol conversion. Server-sent
// events are restored one complete event at a time; JSON bodies are buffered
// and restored whole. Error responses and other content types pass through.
type privacyRestoreWriter struct {
	gin.ResponseWriter
	restorer *PrivacyResponseRestorer
	service  *PrivacyFilterService
	vault    *privacyfilter.Vault

	mode     privacyWriterMode
	pending  []byte
	accepted int
	finished bool
}

// InstallPrivacyRestoreWriter wraps c.Writer when the request carries values to
// restore. FinishPrivacyRestore must run before the handler returns.
func InstallPrivacyRestoreWriter(c *gin.Context, svc *PrivacyFilterService, protocol string, vault *privacyfilter.Vault) {
	if c == nil || vault == nil || vault.Len() == 0 {
		return
	}
	if _, exists := c.Get(privacyRestoreWriterKey); exists {
		return
	}
	restorer := NewPrivacyResponseRestorer(protocol, vault)
	if restorer == nil {
		return
	}
	writer := &privacyRestoreWriter{ResponseWriter: c.Writer, restorer: restorer, service: svc, vault: vault}
	c.Writer = writer
	c.Set(privacyRestoreWriterKey, writer)
}

// FinishPrivacyRestore writes what the restore writer still holds and removes it.
func FinishPrivacyRestore(c *gin.Context) {
	if c == nil {
		return
	}
	value, exists := c.Get(privacyRestoreWriterKey)
	if !exists {
		return
	}
	writer, ok := value.(*privacyRestoreWriter)
	if !ok {
		return
	}
	writer.finish()
	if c.Writer == writer {
		c.Writer = writer.ResponseWriter
	}
}

func (w *privacyRestoreWriter) decide() {
	if w.mode != privacyWriterUndecided {
		return
	}
	contentType := strings.ToLower(w.Header().Get("Content-Type"))
	switch {
	case w.Status() >= http.StatusBadRequest:
		w.mode = privacyWriterPassthrough
	case strings.Contains(contentType, "text/event-stream"):
		w.mode = privacyWriterSSE
	case strings.Contains(contentType, "json"):
		w.mode = privacyWriterJSON
	default:
		w.mode = privacyWriterPassthrough
	}
}

func (w *privacyRestoreWriter) Write(data []byte) (int, error) {
	w.decide()
	if w.finished || w.mode == privacyWriterPassthrough {
		return w.ResponseWriter.Write(data)
	}
	w.accepted += len(data)
	w.pending = append(w.pending, data...)
	if w.mode == privacyWriterSSE {
		return len(data), w.drainEvents(false)
	}
	return len(data), nil
}

func (w *privacyRestoreWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }

// WriteHeaderNow is deferred for JSON bodies: restoring changes their length,
// so headers may only go out once the body is final.
func (w *privacyRestoreWriter) WriteHeaderNow() {
	contentType := strings.ToLower(w.Header().Get("Content-Type"))
	if w.mode == privacyWriterJSON || w.mode == privacyWriterUndecided && strings.Contains(contentType, "json") && w.Status() < http.StatusBadRequest {
		return
	}
	w.ResponseWriter.WriteHeaderNow()
}

func (w *privacyRestoreWriter) Flush() {
	if w.mode == privacyWriterJSON && !w.finished {
		return
	}
	w.ResponseWriter.Flush()
}

// Size and Written count bytes the gateway handed over, held back or not, so
// failover keeps treating a response as started once it has written anything.
func (w *privacyRestoreWriter) Size() int {
	if w.mode == privacyWriterSSE || w.mode == privacyWriterJSON {
		return w.accepted
	}
	return w.ResponseWriter.Size()
}

func (w *privacyRestoreWriter) Written() bool {
	if (w.mode == privacyWriterSSE || w.mode == privacyWriterJSON) && w.accepted > 0 {
		return true
	}
	return w.ResponseWriter.Written()
}

func (w *privacyRestoreWriter) finish() {
	if w.finished {
		return
	}
	switch w.mode {
	case privacyWriterSSE:
		_ = w.drainEvents(true)
		w.writeEvents(w.restorer.Finish())
		w.finished = true
		w.ResponseWriter.Flush()
	case privacyWriterJSON:
		body := w.restorer.RestoreBody(w.pending)
		w.pending = nil
		w.finished = true
		if !w.ResponseWriter.Written() {
			w.Header().Del("Content-Length")
			if w.Header().Get("Content-Encoding") == "" {
				w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			}
		}
		_, _ = w.ResponseWriter.Write(body)
	default:
		w.finished = true
	}
	w.service.RecordRestore(w.vault)
}

// drainEvents restores and writes every complete event. With final set, a
// trailing event without its blank line is processed too.
func (w *privacyRestoreWriter) drainEvents(final bool) error {
	for len(w.pending) > 0 {
		end, next := sseEventEnd(w.pending)
		if end < 0 {
			if !final {
				return nil
			}
			end, next = len(w.pending), len(w.pending)
		}
		block := w.pending[:end]
		separator := append([]byte(nil), w.pending[end:next]...)
		if len(separator) == 0 {
			separator = []byte("\n\n")
		}
		rest := w.pending[next:]
		if err := w.writeBlock(block, separator); err != nil {
			w.pending = append([]byte(nil), rest...)
			return err
		}
		w.pending = append(w.pending[:0], rest...)
	}
	return nil
}

func sseEventEnd(buffer []byte) (int, int) {
	lf := bytes.Index(buffer, []byte("\n\n"))
	crlf := bytes.Index(buffer, []byte("\r\n\r\n"))
	switch {
	case crlf >= 0 && (lf < 0 || crlf <= lf):
		return crlf, crlf + 4
	case lf >= 0:
		return lf, lf + 2
	}
	return -1, -1
}

func (w *privacyRestoreWriter) writeBlock(block, separator []byte) error {
	lines := strings.Split(strings.ReplaceAll(string(block), "\r\n", "\n"), "\n")
	name := ""
	var data []string
	var other []string
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "data:"):
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		case strings.HasPrefix(line, "event:"):
			name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		default:
			other = append(other, line)
		}
	}
	if len(data) == 0 {
		_, err := w.ResponseWriter.Write(append(append([]byte(nil), block...), separator...))
		return err
	}
	events := w.restorer.RestoreEvent(name, []byte(strings.Join(data, "\n")))
	var out bytes.Buffer
	for i, event := range events {
		last := i == len(events)-1
		if last {
			for _, line := range other {
				if line != "" {
					out.WriteString(line)
					out.WriteByte('\n')
				}
			}
		}
		if event.Name != "" {
			out.WriteString("event: ")
			out.WriteString(event.Name)
			out.WriteByte('\n')
		}
		out.WriteString("data: ")
		out.Write(event.Data)
		out.WriteString("\n\n")
	}
	_, err := w.ResponseWriter.Write(out.Bytes())
	return err
}

func (w *privacyRestoreWriter) writeEvents(events []PrivacyEvent) {
	for _, event := range events {
		var out bytes.Buffer
		if event.Name != "" {
			out.WriteString("event: " + event.Name + "\n")
		}
		out.WriteString("data: ")
		out.Write(event.Data)
		out.WriteString("\n\n")
		_, _ = w.ResponseWriter.Write(out.Bytes())
	}
}

// RestorePrivacyFrames restores one WebSocket frame, returning the frames to
// send in its place.
func (r *PrivacyResponseRestorer) RestorePrivacyFrames(frame []byte) [][]byte {
	if r == nil || !r.active() {
		return [][]byte{frame}
	}
	events := r.RestoreEvent("", frame)
	frames := make([][]byte, len(events))
	for i, event := range events {
		frames[i] = event.Data
	}
	return frames
}
