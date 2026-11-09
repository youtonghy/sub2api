package privacyfilter

import (
	"math/big"
	"regexp"
	"strings"
)

var (
	reCardCandidate = regexp.MustCompile(`[0-9](?:[ -]?[0-9]){12,18}`)
	reIBANCandidate = regexp.MustCompile(`\b[A-Z]{2}[0-9]{2}[ ]?[A-Z0-9]`)
)

// ibanLengths lists the registered IBAN length for each country code.
var ibanLengths = map[string]int{
	"AD": 24, "AE": 23, "AL": 28, "AT": 20, "AZ": 28, "BA": 20, "BE": 16, "BG": 22, "BH": 22, "BR": 29, "BY": 28,
	"CH": 21, "CR": 22, "CY": 28, "CZ": 24, "DE": 22, "DK": 18, "DO": 28, "EE": 20, "EG": 29, "ES": 24, "FI": 18,
	"FO": 18, "FR": 27, "GB": 22, "GE": 22, "GI": 23, "GL": 18, "GR": 27, "GT": 28, "HR": 21, "HU": 28, "IE": 22,
	"IL": 23, "IQ": 23, "IS": 26, "IT": 27, "JO": 30, "KW": 30, "KZ": 20, "LB": 28, "LC": 32, "LI": 21, "LT": 20,
	"LU": 20, "LV": 21, "MC": 27, "MD": 24, "ME": 22, "MK": 19, "MR": 27, "MT": 31, "MU": 30, "NL": 18, "NO": 15,
	"PK": 24, "PL": 28, "PS": 29, "PT": 25, "QA": 29, "RO": 24, "RS": 22, "SA": 24, "SC": 31, "SE": 24, "SI": 19,
	"SK": 24, "SM": 27, "ST": 25, "SV": 28, "TL": 23, "TN": 24, "TR": 26, "UA": 29, "VA": 22, "VG": 24, "XK": 20,
}

func appendFinancialSpans(spans []span, text string) []span {
	for _, m := range reCardCandidate.FindAllStringIndex(text, -1) {
		if isolatedNumber(text, m[0], m[1]) && isPaymentCard(text[m[0]:m[1]]) {
			spans = append(spans, span{m[0], m[1], CategoryFinancial})
		}
	}
	for _, m := range reIBANCandidate.FindAllStringIndex(text, -1) {
		if end, ok := scanIBAN(text, m[0]); ok {
			spans = append(spans, span{m[0], end, CategoryFinancial})
		}
	}
	return spans
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// isolatedNumber rejects matches inside a longer number or a decimal fraction.
func isolatedNumber(text string, start, end int) bool {
	if start > 0 {
		before := text[start-1]
		if isDigit(before) || before == '.' && start > 1 && isDigit(text[start-2]) {
			return false
		}
	}
	if end < len(text) {
		after := text[end]
		if isDigit(after) || after == '.' && end+1 < len(text) && isDigit(text[end+1]) {
			return false
		}
	}
	return true
}

func stripSeparators(s string) string {
	return strings.NewReplacer(" ", "", "-", "", ".", "", "(", "", ")", "").Replace(s)
}

// isPaymentCard requires a single separator style, a known network prefix and
// length, and a valid Luhn digit. The prefix table is what keeps millisecond
// timestamps and snowflake IDs from passing on Luhn alone.
func isPaymentCard(candidate string) bool {
	if strings.Contains(candidate, " ") && strings.Contains(candidate, "-") {
		return false
	}
	digits := stripSeparators(candidate)
	return cardNetworkMatches(digits) && luhnValid(digits)
}

func cardNetworkMatches(d string) bool {
	n := len(d)
	prefix := func(length int) int {
		value := 0
		for i := 0; i < length && i < n; i++ {
			value = value*10 + int(d[i]-'0')
		}
		return value
	}
	switch {
	case d[0] == '4':
		return n == 13 || n == 16
	case prefix(2) >= 51 && prefix(2) <= 55, prefix(4) >= 2221 && prefix(4) <= 2720:
		return n == 16
	case prefix(2) == 34, prefix(2) == 37:
		return n == 15
	case prefix(2) == 36, prefix(2) == 38, prefix(3) >= 300 && prefix(3) <= 305:
		return n == 14
	case prefix(4) == 6011, prefix(2) == 65, prefix(3) >= 644 && prefix(3) <= 649:
		return n == 16 || n == 19
	case prefix(4) >= 3528 && prefix(4) <= 3589:
		return n >= 16 && n <= 19
	case prefix(2) == 62, prefix(2) == 81:
		return n >= 16 && n <= 19
	}
	return false
}

func luhnValid(digits string) bool {
	sum := 0
	double := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := int(digits[i] - '0')
		if double {
			if d *= 2; d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}
	return sum%10 == 0
}

// scanIBAN consumes exactly the registered length for the country, allowing
// single spaces between characters, and verifies the mod-97 check digits.
func scanIBAN(text string, start int) (int, bool) {
	want, ok := ibanLengths[text[start:start+2]]
	if !ok {
		return 0, false
	}
	var compact strings.Builder
	i := start
	for i < len(text) && compact.Len() < want {
		c := text[i]
		switch {
		case c >= 'A' && c <= 'Z' || isDigit(c):
			compact.WriteByte(c)
			i++
		case c == ' ' && i+1 < len(text) && text[i+1] != ' ':
			i++
		default:
			return 0, false
		}
	}
	if compact.Len() != want {
		return 0, false
	}
	if i < len(text) && (text[i] >= 'A' && text[i] <= 'Z' || isDigit(text[i])) {
		return 0, false
	}
	return i, ibanChecksumValid(compact.String())
}

func ibanChecksumValid(iban string) bool {
	rearranged := iban[4:] + iban[:4]
	var numeric strings.Builder
	for i := 0; i < len(rearranged); i++ {
		c := rearranged[i]
		if isDigit(c) {
			numeric.WriteByte(c)
			continue
		}
		value := int(c-'A') + 10
		numeric.WriteByte(byte('0' + value/10))
		numeric.WriteByte(byte('0' + value%10))
	}
	number, ok := new(big.Int).SetString(numeric.String(), 10)
	return ok && new(big.Int).Mod(number, big.NewInt(97)).Int64() == 1
}
