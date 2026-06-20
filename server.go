package main

import (
	"io/fs"
	"net/http"
	"time"
)

type server struct {
	mux           *http.ServeMux
	web           http.Handler
	client        *http.Client
	nominatimBase string
	osrmBase      string
	cache         *lruCache
}

func newServer(webRoot fs.FS) *server {
	s := &server{
		web:           http.FileServer(http.FS(webRoot)),
		client:        &http.Client{Timeout: 8 * time.Second},
		nominatimBase: "https://nominatim.openstreetmap.org",
		osrmBase:      "https://router.project-osrm.org",
		cache:         newLRUCache(512),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/geocode", s.handleGeocode)
	mux.HandleFunc("GET /api/route", s.handleRoute)
	mux.Handle("/", s.web)
	s.mux = mux
	return s
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	s.mux.ServeHTTP(w, r)
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func writeCached(w http.ResponseWriter, body []byte, ctype string) {
	if ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
