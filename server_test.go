package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func newTestServer() *server {
	return newServer(fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!doctype html><title>maps</title>")},
	})
}

func TestHealthz(t *testing.T) {
	s := newTestServer()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "ok" {
		t.Fatalf("body = %q, want ok", rec.Body.String())
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("nosniff header = %q", got)
	}
	if got := rec.Header().Get("Referrer-Policy"); got != "strict-origin-when-cross-origin" {
		t.Fatalf("referrer-policy header = %q", got)
	}
}

func TestServesIndex(t *testing.T) {
	s := newTestServer()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct == "" {
		t.Fatalf("missing content-type for index")
	}
}
