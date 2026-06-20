package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseLatLon(t *testing.T) {
	lat, lon, err := parseLatLon("45.8338831, 0.0942195")
	if err != nil || lat < 45.83 || lat > 45.84 || lon < 0.09 || lon > 0.10 {
		t.Fatalf("lat=%v lon=%v err=%v", lat, lon, err)
	}
	for _, bad := range []string{"", "1", "abc,1", "1,2,3", "91,0", "0,181"} {
		if _, _, err := parseLatLon(bad); err == nil {
			t.Errorf("parseLatLon(%q) should fail", bad)
		}
	}
}

func TestRouteBadParams(t *testing.T) {
	s := newTestServer()
	for _, q := range []string{
		"/api/route?from=foo&to=bar",
		"/api/route?from=45.8,0.09&to=bad", // from valide, to invalide
	} {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, q, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400", q, rec.Code)
		}
	}
}

func TestRouteUpstreamError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()
	s := newTestServer()
	s.osrmBase = ts.URL
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/route?from=45.8,0.09&to=46.0,0.5", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
}

func TestRouteProxiesLonLatOrder(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// from=45.8,0.09 -> doit devenir lon,lat = 0.09,45.8 en tête de chemin
		if !strings.Contains(r.URL.Path, "/0.090000,45.800000;") {
			t.Errorf("path = %q (ordre lon,lat attendu)", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"routes":[{"distance":1,"duration":1}]}`))
	}))
	defer ts.Close()
	s := newTestServer()
	s.osrmBase = ts.URL
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/route?from=45.8,0.09&to=46.0,0.5", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "routes") {
		t.Fatalf("body = %q", rec.Body.String())
	}
}
