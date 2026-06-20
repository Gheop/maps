package main

import (
	"log"
	"net/http"
	"net/url"
	"strings"
)

func (s *server) handleGeocode(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeJSONError(w, http.StatusBadRequest, `{"error":"missing or invalid q"}`)
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
		log.Printf("geocode upstream failed: %v", err)
		writeJSONError(w, http.StatusBadGateway, `{"error":"geocoding upstream failed"}`)
		return
	}
	if ctype == "" {
		ctype = "application/json"
	}
	s.cache.Set(key, body, ctype)
	writeCached(w, body, ctype)
}
