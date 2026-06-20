package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpstreamGetOK(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != userAgent {
			t.Errorf("UA = %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()
	s := newTestServer()
	body, ctype, err := s.upstreamGet(ts.URL)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if string(body) != `{"ok":true}` || ctype != "application/json" {
		t.Fatalf("body=%q ctype=%q", body, ctype)
	}
}

func TestUpstreamGetNon2xx(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	defer ts.Close()
	s := newTestServer()
	if _, _, err := s.upstreamGet(ts.URL); err == nil {
		t.Fatal("expected error on non-2xx")
	}
}

func TestUpstreamGetTooLarge(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(strings.Repeat("x", maxUpstreamBytes+10)))
	}))
	defer ts.Close()
	s := newTestServer()
	if _, _, err := s.upstreamGet(ts.URL); err == nil {
		t.Fatal("expected error on oversized body")
	}
}
