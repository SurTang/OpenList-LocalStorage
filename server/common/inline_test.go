package common

import "testing"

func TestCanInline(t *testing.T) {
	cases := map[string]bool{
		"document.pdf": true,
		"photo.JPG":    true,
		"movie.mp4":    true,
		"voice.wav":    true,
		"page.html":    false,
		"vector.svg":   false,
		"script.js":    false,
		"archive.zip":  false,
		"noext":        false,
	}
	for name, want := range cases {
		if got := CanInline(name); got != want {
			t.Fatalf("CanInline(%q) = %v, want %v", name, got, want)
		}
	}
}
