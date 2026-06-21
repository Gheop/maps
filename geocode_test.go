package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestGeocodeMissingQ(t *testing.T) {
	s := newTestServer()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/geocode", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGeocodeProxiesAndCaches(t *testing.T) {
	var hits int
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if !strings.Contains(r.URL.RawQuery, "q=Coulonges") {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"features":[{"geometry":{"coordinates":[0.09,45.8]},"properties":{"name":"Coulonges"}}]}`))
	}))
	defer ts.Close()
	s := newTestServer()
	s.photonBase = ts.URL

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/geocode?q=Coulonges", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "45.8") {
			t.Fatalf("body = %q", rec.Body.String())
		}
	}
	if hits != 1 {
		t.Fatalf("upstream hits = %d, want 1 (cache)", hits)
	}
}

func TestGeocodeEscapesQuery(t *testing.T) {
	const want = "Paris & Lyon+test"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("q"); got != want {
			t.Errorf("upstream q = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"features":[]}`))
	}))
	defer ts.Close()
	s := newTestServer()
	s.photonBase = ts.URL

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/geocode?q="+url.QueryEscape(want), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestGeocodeTooLong(t *testing.T) {
	s := newTestServer()
	rec := httptest.NewRecorder()
	q := strings.Repeat("a", 201)
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/geocode?q="+q, nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPhotonToResults(t *testing.T) {
	in := `{"features":[{"geometry":{"coordinates":[0.0906,45.8331]},"properties":{"name":"Coulonges","county":"Charente","country":"France","extent":[0.08,45.84,0.10,45.82]}}]}`
	out, err := photonToResults([]byte(in))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	s := string(out)
	for _, want := range []string{`"lat":"45.8331000"`, `"lon":"0.0906000"`, `"display_name":"Coulonges, Charente, France"`} {
		if !strings.Contains(s, want) {
			t.Fatalf("output %q missing %q", s, want)
		}
	}
	// boundingbox normalisée [sud, nord, ouest, est] = [minLat, maxLat, minLon, maxLon]
	if !strings.Contains(s, `"boundingbox":["45.8200000","45.8400000","0.0800000","0.1000000"]`) {
		t.Fatalf("boundingbox mal normalisée : %q", s)
	}
}
