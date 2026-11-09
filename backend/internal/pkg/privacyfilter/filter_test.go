package privacyfilter

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

var allEnabled = NewCategorySet(AllCategories()...)

func testDetector(t testing.TB) *Detector {
	t.Helper()
	d, err := Shared()
	require.NoError(t, err)
	return d
}

func TestEmbeddedRulesCompile(t *testing.T) {
	d := testDetector(t)
	require.Greater(t, len(d.secrets.rules), 200)
	require.NotEmpty(t, d.secrets.global)
}

func TestRedactDetects(t *testing.T) {
	d := testDetector(t)
	// Assembled at runtime so secret scanners do not flag the fixtures.
	anthropicKey := "sk-ant-api03-" + strings.Repeat("aB3dE6gH9k", 9) + "abc" + "AA"
	githubToken := "ghp_" + "aB3dE6gH9kLm2Pq5St8Vw1Yz4Bc7Ef0Hj3Mn"
	pemBody := strings.Repeat("MIIEpAIBAAKCAQEA7bq0hDFgH3kLmNoPqRsTuVwXyZ\n", 3)

	cases := []struct {
		name     string
		input    string
		category Category
		mustHide string
		mustKeep string
	}{
		{"pem private key", "key:\n-----BEGIN RSA PRIVATE KEY-----\n" + pemBody + "-----END RSA PRIVATE KEY-----\nnext", CategoryPrivateKey, "MIIEpAIB", "next"},
		{"openssh private key", "-----BEGIN OPENSSH PRIVATE KEY-----\n" + pemBody + "-----END OPENSSH PRIVATE KEY-----", CategoryPrivateKey, "MIIEpAIB", ""},
		{"truncated private key", "-----BEGIN PRIVATE KEY-----\n" + pemBody, CategoryPrivateKey, "MIIEpAIB", ""},
		{"escaped newline private key", `-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7bq0hDFgH3kLmNoPq\nAbCd`, CategoryPrivateKey, "MIIEpAIB", ""},
		{"ssh public key", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl3dIeudNqd0DPMRD6OIh65tjkxFNOtwGcWB2gCgPhk me", CategoryPublicKey, "AAAAC3Nza", " me"},
		{"pem public key", "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----", CategoryPublicKey, "MFkwEwYH", ""},
		{"certificate", "-----BEGIN CERTIFICATE-----\nMIIDdzCCAl\n-----END CERTIFICATE-----", CategoryPublicKey, "MIIDdzCCAl", ""},
		{"anthropic key", "use " + anthropicKey + " now", CategoryCredential, anthropicKey, " now"},
		{"github token keeps name", `GITHUB_TOKEN="` + githubToken + `"`, CategoryCredential, githubToken, "GITHUB_TOKEN="},
		{"url password", "DATABASE_URL=postgres://app:S3cretPa55@db.internal:5432/app", CategoryCredential, "S3cretPa55", "db.internal"},
		{"redis url password", "redis://:Zx9kLm2Qp@10.0.0.5:6379/0", CategoryCredential, "Zx9kLm2Qp", ":6379"},
		{"url query token", "https://api.example.net/v1?access_token=abc12345def&x=1", CategoryCredential, "abc12345def", "x=1"},
		{"chinese prose password", "我的密码是 Hunter2xy，请记住", CategoryCredential, "Hunter2xy", "请记住"},
		{"numeric password", "密码是 123456", CategoryCredential, "123456", ""},
		{"english numeric password", "password: 123456", CategoryCredential, "123456", "password:"},
		{"quoted password", `password = "admin"`, CategoryCredential, "admin", "password ="},
		{"json password", `{"db_password": "pa55w0rd!"}`, CategoryCredential, "pa55w0rd!", "db_password"},
		{"bearer header", "Authorization: Bearer abc.DEF-123_456", CategoryCredential, "abc.DEF-123_456", "Authorization"},
		{"basic header", "authorization: basic dXNlcjpwYXNz", CategoryCredential, "dXNlcjpwYXNz", ""},
		{"visa", "card 4111111111111111 ok", CategoryFinancial, "4111111111111111", " ok"},
		{"spaced card", "card 4111 1111 1111 1111", CategoryFinancial, "4111 1111", ""},
		{"dashed card", "card 4111-1111-1111-1111", CategoryFinancial, "4111-1111", ""},
		{"unionpay", "卡号 6222021234567890128", CategoryFinancial, "6222021234567890128", ""},
		{"iban spaced", "IBAN GB82 WEST 1234 5698 7654 32 or else", CategoryFinancial, "WEST 1234", " or else"},
		{"iban compact", "DE89370400440532013000", CategoryFinancial, "DE893704", ""},
		{"china id", "身份证 11010519491231002X", CategoryIdentity, "11010519491231002X", ""},
		{"hong kong id", "HKID A123456(3)", CategoryIdentity, "A123456", ""},
		{"taiwan id", "身分證 A123456789", CategoryIdentity, "A123456789", ""},
		{"us ssn", "SSN 078-05-1120", CategoryIdentity, "078-05-1120", ""},
		{"uk nino", "NINO AB123456C", CategoryIdentity, "AB123456C", ""},
		{"singapore nric", "NRIC S1234567D", CategoryIdentity, "S1234567D", ""},
		{"korea rrn", "주민등록번호 900101-1234567", CategoryIdentity, "900101-1234567", ""},
		{"spain dni", "DNI 12345678Z", CategoryIdentity, "12345678Z", ""},
		{"brazil cpf", "CPF 123.456.789-09", CategoryIdentity, "123.456.789-09", ""},
		{"australia tfn", "TFN 123 456 782", CategoryIdentity, "123 456 782", ""},
		{"canada sin", "SIN 130 692 544", CategoryIdentity, "130 692 544", ""},
		{"my number", "マイナンバー 123456789018", CategoryIdentity, "123456789018", ""},
		{"passport", "护照号 E12345678", CategoryIdentity, "E12345678", ""},
		{"vless link", "vless://b831381d-6324-4d53-ad4f-8cda48b30811@host:443?sid=6ba8#n", CategoryProxy, "b831381d", ""},
		{"vmess link", "vmess://eyJ2IjoiMiIsInBzIjoibm9kZSJ9 end", CategoryProxy, "eyJ2Ijoi", " end"},
		{"trojan link", "trojan://Pa55w0rdXyz@example.net:443#n", CategoryProxy, "Pa55w0rdXyz", ""},
		{"ss link", "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@host:8388#n", CategoryProxy, "YWVzLTI1", ""},
		{"email", "mail me at alice.smith@corp.net today", CategoryEmail, "alice.smith@corp.net", " today"},
		{"public ipv4", "server 8.8.4.4 is up", CategoryIP, "8.8.4.4", " is up"},
		{"ipv6", "addr 2001:4860:4860:0:0:0:0:8888 up", CategoryIP, "2001:4860", " up"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := d.Redact(tc.input, allEnabled)
			require.True(t, result.Changed, "no detection in %q", tc.input)
			require.NotContains(t, result.Text, tc.mustHide)
			require.Contains(t, result.Text, Placeholder(tc.category))
			require.GreaterOrEqual(t, result.Counts[tc.category], 1)
			if tc.mustKeep != "" {
				require.Contains(t, result.Text, tc.mustKeep)
			}
		})
	}
}

func TestRedactAadhaarChecksum(t *testing.T) {
	require.True(t, verhoeffValid(digitsOf("2363")))
	require.False(t, verhoeffValid(digitsOf("2364")))
}

func TestRedactInvalidChecksumsIgnored(t *testing.T) {
	d := testDetector(t)
	enabled := NewCategorySet(CategoryFinancial, CategoryIdentity)
	for _, input := range []string{
		"身份证 110105194912310021",
		"card 4111111111111112",
		"IBAN GB82WEST12345698765433",
		"DNI 12345678A",
		"CPF 123.456.789-00",
		"SSN 000-12-3456",
		"TFN 123 456 783",
		"SIN 046 454 287",
		"NRIC S1234567A",
	} {
		require.False(t, d.Redact(input, enabled).Changed, input)
	}
}

// Coding agents are the main traffic: these must pass through untouched with the
// default categories, otherwise file edits stop matching their originals.
func TestRedactLeavesOrdinaryCodeAlone(t *testing.T) {
	d := testDetector(t)
	enabled := NewCategorySet(DefaultCategories()...)
	for _, input := range []string{
		"const secret = process.env.API_SECRET;",
		"token = getToken();",
		"const token = strings.TrimSpace(raw)",
		"token: string",
		"password: string;",
		"password = confirmPassword",
		"def login(password=None, token=token):",
		"if password == confirmPassword { return }",
		"api_key = os.environ['API_KEY']",
		"apiKey: ${API_KEY}",
		"password: {{ .Values.password }}",
		"max_tokens: 4096, input_token: 100",
		"pwd=/home/app/work",
		"order id 193847562019384756 from DB",
		"createdAt: 1762646400000, updatedAt: 1762646400018, 1762646400026",
		"pi = 0.4111111111111111",
		"commit 056d21351a8f3c9e0b7d4f2a1c6e8b9d0f3a2c1e",
		"id: b831381d-6324-4d53-ad4f-8cda48b30811",
		"toolu_01A09q90qw90lq917835lq9 msg_01XFDUDYJgAACzvnptvVoYEL",
		"see https://example.net/docs?key=value&page=2",
		"the bearer of bad news, basic understanding",
		"密码是什么？密码为空时提示用户",
		"请输入密码：请联系管理员",
		"vless:// is a protocol prefix",
		"sin(3.14) + 046 454 286",
	} {
		result := d.Redact(input, enabled)
		require.False(t, result.Changed, "%q became %q", input, result.Text)
	}
}

func TestRedactContactExemptions(t *testing.T) {
	d := testDetector(t)
	enabled := NewCategorySet(CategoryEmail, CategoryIP)
	for _, input := range []string{
		"git clone git@github.com:org/repo.git",
		"ssh deploy@host.internal",
		"Co-Authored-By: Claude <noreply@anthropic.com>",
		"listen on 127.0.0.1:8080 and 0.0.0.0",
		"upgrade to version 1.25.3.1",
		"std::cout << 12:30:45",
	} {
		result := d.Redact(input, enabled)
		require.False(t, result.Changed, "%q became %q", input, result.Text)
	}
}

func TestRedactProxyConfig(t *testing.T) {
	d := testDetector(t)
	config := `{"outbounds":[{"protocol":"vless","settings":{"vnext":[{"users":[{"id":"b831381d-6324-4d53-ad4f-8cda48b30811"}]}]},
"streamSettings":{"realitySettings":{"publicKey":"Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw","shortId":"6ba85179e30d4fc2","shortIds":["ab12","cd34"]}}}]}`
	result := d.Redact(config, NewCategorySet(CategoryProxy, CategoryCredential))
	require.NotContains(t, result.Text, "b831381d")
	require.NotContains(t, result.Text, "6ba85179e30d4fc2")
	require.NotContains(t, result.Text, "ab12")
	require.Contains(t, result.Text, "Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw", "public key stays visible")

	clash := "proxies:\n  - name: a\n    type: trojan\n    password: hunterTwo\n    uuid: b831381d-6324-4d53-ad4f-8cda48b30811\nurl: https://sub.example.net/api/v1/client/subscribe?token=8f3a9c2e1b7d4a6f\n"
	result = d.Redact(clash, NewCategorySet(CategoryProxy))
	require.NotContains(t, result.Text, "hunterTwo")
	require.NotContains(t, result.Text, "b831381d")
	require.NotContains(t, result.Text, "8f3a9c2e1b7d4a6f")

	plain := "user id: b831381d-6324-4d53-ad4f-8cda48b30811"
	require.False(t, d.Redact(plain, NewCategorySet(CategoryProxy)).Changed, "UUIDs outside proxy configs are ordinary IDs")
}

func TestRedactRespectsCategorySwitches(t *testing.T) {
	d := testDetector(t)
	input := "mail alice@corp.net card 4111111111111111"

	result := d.Redact(input, NewCategorySet(CategoryFinancial))
	require.Contains(t, result.Text, "alice@corp.net")
	require.NotContains(t, result.Text, "4111111111111111")

	require.False(t, d.Redact(input, 0).Changed)
}

func TestDefaultCategories(t *testing.T) {
	defaults := NewCategorySet(DefaultCategories()...)
	for _, on := range []Category{CategoryPrivateKey, CategoryCredential, CategoryFinancial, CategoryIdentity, CategoryProxy} {
		require.True(t, defaults.Has(on), on)
	}
	for _, off := range []Category{CategoryPublicKey, CategoryIP, CategoryEmail} {
		require.False(t, defaults.Has(off), off)
	}
}

// Clients resend history every turn, so redacted text must be a fixed point:
// otherwise prompt cache prefixes would shift between turns.
func TestRedactIsIdempotent(t *testing.T) {
	d := testDetector(t)
	input := "password: abc12345 token=Zx9kLm2QpRt7 card 4111111111111111 mail a@corp.net\n" +
		"-----BEGIN PRIVATE KEY-----\nMIIEpAIB\n-----END PRIVATE KEY-----\n" +
		"Authorization: Bearer abc.DEF-123_456 postgres://u:S3cretPa55@db:5432/x"
	once := d.Redact(input, allEnabled)
	require.True(t, once.Changed)
	twice := d.Redact(once.Text, allEnabled)
	require.False(t, twice.Changed, "second pass changed %q to %q", once.Text, twice.Text)
}

func TestRedactMergesOverlaps(t *testing.T) {
	merged := mergeSpans([]span{{0, 10, CategoryEmail}, {5, 20, CategoryCredential}, {30, 31, CategoryIP}, {4, 2, CategoryIP}})
	require.Equal(t, []span{{0, 20, CategoryCredential}, {30, 31, CategoryIP}}, merged)
}

func TestRedactDoesNotPanicOnBoundaries(t *testing.T) {
	d := testDetector(t)
	for _, input := range []string{
		"api key" + strings.Repeat("A", 40),
		"my api keyAbCdEfGhIjKlMnOpQrStUvWxYz012345",
		"-----BEGIN PRIVATE KEY-----",
		"password:", "://", "@", "[REDACTED:credential]", "GB82", "GB82 ", "4", "A12345", "\xff\xfe password: \xff",
	} {
		require.NotPanics(t, func() { d.Redact(input, allEnabled) }, input)
	}
}

func benchmarkText(size int) string {
	line := "func handle(ctx context.Context, req *Request) error { token := req.Token; return svc.Call(ctx, token) }\n" +
		"// 请帮我看一下这个函数为什么报错，版本 1.2.3，api key 的校验在 auth 模块\n"
	return strings.Repeat(line, size/len(line)+1)
}

func benchmarkRedact(b *testing.B, size int) {
	d := testDetector(b)
	text := benchmarkText(size)
	enabled := NewCategorySet(DefaultCategories()...)
	b.SetBytes(int64(len(text)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		d.Redact(text, enabled)
	}
}

func BenchmarkRedact4KB(b *testing.B)   { benchmarkRedact(b, 4*1024) }
func BenchmarkRedact32KB(b *testing.B)  { benchmarkRedact(b, 32*1024) }
func BenchmarkRedact256KB(b *testing.B) { benchmarkRedact(b, 256*1024) }
func BenchmarkRedact1MB(b *testing.B)   { benchmarkRedact(b, 1024*1024) }
