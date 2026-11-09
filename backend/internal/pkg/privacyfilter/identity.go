package privacyfilter

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	reCNIdentity = regexp.MustCompile(`[0-9]{17}[0-9Xx]`)
	reHKIdentity = regexp.MustCompile(`\b[A-Z]{1,2}[0-9]{6}\([0-9A]\)`)
	reTWIdentity = regexp.MustCompile(`\b[A-Z][12][0-9]{8}\b`)
	reUSSSN      = regexp.MustCompile(`\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b`)
	reUKNINO     = regexp.MustCompile(`\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?[0-9]{2} ?[0-9]{2} ?[0-9]{2} ?[A-D]\b`)
	reSGNRIC     = regexp.MustCompile(`\b[STFGM][0-9]{7}[A-Z]\b`)
	reKRRRN      = regexp.MustCompile(`\b[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])-[1-8][0-9]{6}\b`)
	reESDNI      = regexp.MustCompile(`\b[0-9]{8}[A-Z]\b`)
	reESNIE      = regexp.MustCompile(`\b[XYZ][0-9]{7}[A-Z]\b`)
	reBRCPF      = regexp.MustCompile(`\b[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}\b`)
)

const labelGap = `\W{0,6}(?:号码|號碼|号|號|番号)?\W{0,4}`

// labelledIdentities cover numbers too plain to detect without an adjacent label.
var labelledIdentities = []struct {
	re       *regexp.Regexp
	validate func(value string) bool
}{
	{regexp.MustCompile(`(?i:\btfn\b|tax file (?:number|no\.?))` + labelGap + `([0-9]{3}[ -]?[0-9]{3}[ -]?[0-9]{2,3})\b`), validAustralianTFN},
	{regexp.MustCompile(`(?i:\bmedicare\b)(?i: (?:card|number|no\.?))*` + labelGap + `([2-6][0-9]{3}[ -]?[0-9]{5}[ -]?[0-9]{1,2})\b`), validAustralianMedicare},
	{regexp.MustCompile(`(?:\bSIN\b|(?i:social insurance(?: number| no\.?)?))` + labelGap + `([0-9]{3}[ -]?[0-9]{3}[ -]?[0-9]{3})\b`), validCanadianSIN},
	{regexp.MustCompile(`(?i:\baadha+r\b|आधार)` + labelGap + `([2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4})\b`), validAadhaar},
	{regexp.MustCompile(`(?i:\bmy ?number\b|マイナンバー|個人番号)` + labelGap + `([0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4})\b`), validMyNumber},
	{regexp.MustCompile(`(?i:\bssn\b|social security(?: number| no\.?)?|社会安全号)` + labelGap + `([0-9]{3}[ ]?[0-9]{2}[ ]?[0-9]{4})\b`), validUSSSN},
	{regexp.MustCompile(`(?i:\bcpf\b)` + labelGap + `([0-9]{11})\b`), validBrazilianCPF},
	{regexp.MustCompile(`(?i:\bhkid\b|香港身份证|香港身份證)` + labelGap + `([A-Z]{1,2}[0-9]{6}[0-9A])\b`), validHongKongID},
	{regexp.MustCompile(`(?i:\bpassport(?: (?:number|no\.?))?\b|护照|護照|パスポート|여권)` + labelGap + `([A-Z0-9]{6,12})\b`), validPassportShape},
}

// Window margins around a digit run: enough for the longest label before it and
// the trailing check character after it.
const (
	identityWindowBefore = 64
	identityWindowAfter  = 32
)

// appendIdentitySpans scans only the neighbourhood of digit runs. Every format
// here needs digits, and typical prompts have few, so this avoids running each
// unanchored pattern over the whole text.
func appendIdentitySpans(spans []span, text string) []span {
	for _, window := range digitWindows(text) {
		spans = appendIdentityWindow(spans, text[window[0]:window[1]], window[0])
	}
	return spans
}

// digitWindows returns merged ranges around runs of three or more digits, and
// around the spaced pairs used by UK National Insurance numbers.
func digitWindows(text string) [][2]int {
	var windows [][2]int
	for i := 0; i < len(text); {
		if !isDigit(text[i]) {
			i++
			continue
		}
		start := i
		for i < len(text) && isDigit(text[i]) {
			i++
		}
		spacedPair := i-start == 2 && i+1 < len(text) && text[i] == ' ' && isDigit(text[i+1])
		if i-start < 3 && !spacedPair {
			continue
		}
		low, high := start-identityWindowBefore, i+identityWindowAfter
		if low < 0 {
			low = 0
		}
		if high > len(text) {
			high = len(text)
		}
		if last := len(windows) - 1; last >= 0 && low <= windows[last][1] {
			windows[last][1] = high
			continue
		}
		windows = append(windows, [2]int{low, high})
	}
	return windows
}

// unlabelledIdentities are distinctive once their check digit or date holds.
var unlabelledIdentities = []struct {
	re       *regexp.Regexp
	validate func(string) bool
}{
	{reHKIdentity, validHongKongID},
	{reTWIdentity, validTaiwanID},
	{reUSSSN, validUSSSN},
	{reUKNINO, validUKNINO},
	{reSGNRIC, validSingaporeNRIC},
	{reKRRRN, validKoreanRRN},
	{reESDNI, validSpanishDNI},
	{reESNIE, validSpanishNIE},
	{reBRCPF, validBrazilianCPF},
}

func appendIdentityWindow(spans []span, window string, offset int) []span {
	for _, m := range reCNIdentity.FindAllStringIndex(window, -1) {
		if isolatedNumber(window, m[0], m[1]) && validChineseID(window[m[0]:m[1]]) {
			spans = append(spans, span{offset + m[0], offset + m[1], CategoryIdentity})
		}
	}
	for _, entry := range unlabelledIdentities {
		for _, m := range entry.re.FindAllStringIndex(window, -1) {
			if entry.validate(window[m[0]:m[1]]) {
				spans = append(spans, span{offset + m[0], offset + m[1], CategoryIdentity})
			}
		}
	}
	for _, entry := range labelledIdentities {
		for _, m := range entry.re.FindAllStringSubmatchIndex(window, -1) {
			if entry.validate(window[m[2]:m[3]]) {
				spans = append(spans, span{offset + m[2], offset + m[3], CategoryIdentity})
			}
		}
	}
	return spans
}

func digitsOf(value string) []int {
	out := make([]int, 0, len(value))
	for i := 0; i < len(value); i++ {
		if isDigit(value[i]) {
			out = append(out, int(value[i]-'0'))
		}
	}
	return out
}

func validDate(year, month, day int) bool {
	parsed := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	return parsed.Year() == year && int(parsed.Month()) == month && parsed.Day() == day
}

var cnProvinces = map[string]bool{
	"11": true, "12": true, "13": true, "14": true, "15": true, "21": true, "22": true, "23": true, "31": true,
	"32": true, "33": true, "34": true, "35": true, "36": true, "37": true, "41": true, "42": true, "43": true,
	"44": true, "45": true, "46": true, "50": true, "51": true, "52": true, "53": true, "54": true, "61": true,
	"62": true, "63": true, "64": true, "65": true, "71": true, "81": true, "82": true,
}

// validChineseID applies the GB 11643-1999 province, birth date and check digit.
func validChineseID(value string) bool {
	if len(value) != 18 || !cnProvinces[value[:2]] {
		return false
	}
	year, _ := strconv.Atoi(value[6:10])
	month, _ := strconv.Atoi(value[10:12])
	day, _ := strconv.Atoi(value[12:14])
	if year < 1900 || year > 2100 || !validDate(year, month, day) {
		return false
	}
	weights := [...]int{7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2}
	sum := 0
	for i, weight := range weights {
		sum += int(value[i]-'0') * weight
	}
	return "10X98765432"[sum%11] == strings.ToUpper(value[17:])[0]
}

func validHongKongID(value string) bool {
	compact := stripSeparators(value)
	if len(compact) != 8 && len(compact) != 9 {
		return false
	}
	letters := compact[:len(compact)-7]
	sum := 0
	if len(letters) == 1 {
		sum = 36*9 + int(letters[0]-'A'+10)*8
	} else {
		sum = int(letters[0]-'A'+10)*9 + int(letters[1]-'A'+10)*8
	}
	body := compact[len(letters) : len(compact)-1]
	for i := 0; i < len(body); i++ {
		sum += int(body[i]-'0') * (7 - i)
	}
	check := compact[len(compact)-1]
	checkValue := int(check - '0')
	if check == 'A' {
		checkValue = 10
	}
	return (sum+checkValue)%11 == 0
}

var taiwanLetterValues = [...]int{10, 11, 12, 13, 14, 15, 16, 17, 34, 18, 19, 20, 21, 22, 35, 23, 24, 25, 26, 27, 28, 29, 32, 30, 31, 33}

func validTaiwanID(value string) bool {
	letter := taiwanLetterValues[value[0]-'A']
	sum := letter/10 + letter%10*9
	for i := 1; i <= 8; i++ {
		sum += int(value[i]-'0') * (9 - i)
	}
	sum += int(value[9] - '0')
	return sum%10 == 0
}

func validUSSSN(value string) bool {
	digits := digitsOf(value)
	if len(digits) != 9 {
		return false
	}
	area := digits[0]*100 + digits[1]*10 + digits[2]
	group := digits[3]*10 + digits[4]
	serial := digits[5]*1000 + digits[6]*100 + digits[7]*10 + digits[8]
	return area != 0 && area != 666 && area < 900 && group != 0 && serial != 0
}

func validUKNINO(value string) bool {
	switch value[:2] {
	case "BG", "GB", "KN", "NK", "NT", "TN", "ZZ":
		return false
	}
	return true
}

func validSingaporeNRIC(value string) bool {
	weights := [...]int{2, 7, 6, 5, 4, 3, 2}
	sum := 0
	for i, weight := range weights {
		sum += int(value[i+1]-'0') * weight
	}
	table := "JZIHGFEDCBA"
	switch value[0] {
	case 'T':
		sum += 4
	case 'F':
		table = "XWUTRQPNMLK"
	case 'G':
		table = "XWUTRQPNMLK"
		sum += 4
	case 'M':
		table = "XWUTRQPNJLK"
		sum += 3
	}
	return table[sum%11] == value[8]
}

// validKoreanRRN checks the date only: numbers issued since October 2020 no
// longer carry a check digit, so verifying one would miss them.
func validKoreanRRN(value string) bool {
	year, _ := strconv.Atoi(value[:2])
	month, _ := strconv.Atoi(value[2:4])
	day, _ := strconv.Atoi(value[4:6])
	century := 1900
	switch value[7] {
	case '3', '4', '7', '8':
		century = 2000
	}
	return validDate(century+year, month, day)
}

const spanishLetters = "TRWAGMYFPDXBNJZSQVHLCKE"

func validSpanishDNI(value string) bool {
	number, err := strconv.Atoi(value[:8])
	return err == nil && spanishLetters[number%23] == value[8]
}

func validSpanishNIE(value string) bool {
	prefix := strings.IndexByte("XYZ", value[0])
	number, err := strconv.Atoi(value[1:8])
	if prefix < 0 || err != nil {
		return false
	}
	return spanishLetters[(prefix*10000000+number)%23] == value[8]
}

func validBrazilianCPF(value string) bool {
	digits := digitsOf(value)
	if len(digits) != 11 {
		return false
	}
	allSame := true
	for _, d := range digits {
		allSame = allSame && d == digits[0]
	}
	if allSame {
		return false
	}
	check := func(count int) int {
		sum := 0
		for i := 0; i < count; i++ {
			sum += digits[i] * (count + 1 - i)
		}
		remainder := sum * 10 % 11
		if remainder == 10 {
			return 0
		}
		return remainder
	}
	return check(9) == digits[9] && check(10) == digits[10]
}

func validAustralianTFN(value string) bool {
	digits := digitsOf(value)
	var weights []int
	switch len(digits) {
	case 8:
		weights = []int{10, 7, 8, 4, 6, 3, 5, 1}
	case 9:
		weights = []int{1, 4, 3, 7, 5, 8, 6, 9, 10}
	default:
		return false
	}
	sum := 0
	for i, weight := range weights {
		sum += digits[i] * weight
	}
	return sum%11 == 0
}

func validAustralianMedicare(value string) bool {
	digits := digitsOf(value)
	if len(digits) != 10 && len(digits) != 11 {
		return false
	}
	weights := [...]int{1, 3, 7, 9, 1, 3, 7, 9}
	sum := 0
	for i, weight := range weights {
		sum += digits[i] * weight
	}
	return sum%10 == digits[8]
}

func validCanadianSIN(value string) bool {
	digits := stripSeparators(value)
	return len(digits) == 9 && digits[0] != '0' && digits[0] != '8' && luhnValid(digits)
}

var (
	verhoeffD = [10][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}, {1, 2, 3, 4, 0, 6, 7, 8, 9, 5}, {2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
		{3, 4, 0, 1, 2, 8, 9, 5, 6, 7}, {4, 0, 1, 2, 3, 9, 5, 6, 7, 8}, {5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
		{6, 5, 9, 8, 7, 1, 0, 4, 3, 2}, {7, 6, 5, 9, 8, 2, 1, 0, 4, 3}, {8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
		{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
	}
	verhoeffP = [8][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}, {1, 5, 7, 6, 2, 8, 3, 0, 9, 4}, {5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
		{8, 9, 1, 6, 0, 4, 3, 5, 2, 7}, {9, 4, 5, 3, 1, 2, 6, 8, 7, 0}, {4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
		{2, 7, 9, 3, 8, 0, 6, 4, 1, 5}, {7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
	}
)

func verhoeffValid(digits []int) bool {
	checksum := 0
	for i := 0; i < len(digits); i++ {
		checksum = verhoeffD[checksum][verhoeffP[i%8][digits[len(digits)-1-i]]]
	}
	return checksum == 0
}

func validAadhaar(value string) bool {
	digits := digitsOf(value)
	return len(digits) == 12 && verhoeffValid(digits)
}

func validMyNumber(value string) bool {
	digits := digitsOf(value)
	if len(digits) != 12 {
		return false
	}
	sum := 0
	for n := 1; n <= 11; n++ {
		weight := n + 1
		if n > 6 {
			weight = n - 5
		}
		sum += digits[11-n] * weight
	}
	remainder := sum % 11
	check := 0
	if remainder > 1 {
		check = 11 - remainder
	}
	return check == digits[11]
}

// validPassportShape requires digits so a following word is not taken as a number.
func validPassportShape(value string) bool {
	return len(digitsOf(value)) >= 4 && value == strings.ToUpper(value)
}
