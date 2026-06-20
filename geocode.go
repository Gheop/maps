package main

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *server) handleGeocode(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		http.Error(w, `{"error":"missing or invalid q"}`, http.StatusBadRequest)
		return
	}
	key := "geocode:" + q
	if body, ctype, ok := s.cache.Get(key); ok {
		writeCached(w, body, ctype)
		return
	}
	u := s.nominatimBase + "/search?format=jsonv2&limit=5&accept-language=fr&q=" + url.QueryEscape(q)
	body, ctype, err := s.upstreamGet(u)
	if err != nil {
		http.Error(w, `{"error":"geocoding upstream failed"}`, http.StatusBadGateway)
		return
	}
	if ctype == "" {
		ctype = "application/json"
	}
	s.cache.Set(key, body, ctype)
	writeCached(w, body, ctype)
}
