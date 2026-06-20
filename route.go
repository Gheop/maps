package main

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func parseLatLon(s string) (float64, float64, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("expected lat,lon")
	}
	lat, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	if err != nil {
		return 0, 0, err
	}
	lon, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err != nil {
		return 0, 0, err
	}
	if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, fmt.Errorf("out of range")
	}
	return lat, lon, nil
}

func (s *server) handleRoute(w http.ResponseWriter, r *http.Request) {
	flat, flon, err := parseLatLon(r.URL.Query().Get("from"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, `{"error":"bad from"}`)
		return
	}
	tlat, tlon, err := parseLatLon(r.URL.Query().Get("to"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, `{"error":"bad to"}`)
		return
	}
	key := fmt.Sprintf("route:%.6f,%.6f;%.6f,%.6f", flat, flon, tlat, tlon)
	if body, ctype, ok := s.cache.Get(key); ok {
		writeCached(w, body, ctype)
		return
	}
	u := fmt.Sprintf("%s/route/v1/driving/%f,%f;%f,%f?overview=full&geometries=geojson",
		s.osrmBase, flon, flat, tlon, tlat)
	body, ctype, err := s.upstreamGet(u)
	if err != nil {
		log.Printf("route upstream failed: %v", err)
		writeJSONError(w, http.StatusBadGateway, `{"error":"routing upstream failed"}`)
		return
	}
	if ctype == "" {
		ctype = "application/json"
	}
	s.cache.Set(key, body, ctype)
	writeCached(w, body, ctype)
}
