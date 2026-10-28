package handles

import "testing"

func TestUniquePackageRoot(t *testing.T) {
	used := map[string]int{}
	cases := []struct{ in, want string }{
		{"docs", "docs"},
		{"docs", "docs_2"},
		{"a/b", "a_b"},
		{"  ", "文件"},
		{"file.txt", "file.txt"},
		{"file.txt", "file_2.txt"},
	}
	for _, c := range cases {
		if got := uniquePackageRoot(c.in, used); got != c.want {
			t.Fatalf("uniquePackageRoot(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
