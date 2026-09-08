package main

import (
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Requêtes émises par un chargement du shell (index + CSS + modules + icônes + SW).
var shellPaths = []string{
	"/", "/default.css", "/js/main.js", "/js/map.js", "/js/tilemath.js", "/js/url.js",
	"/js/search.js", "/js/route.js", "/js/geo.js", "/js/geocode.js", "/js/autocomplete.js",
	"/route.png", "/favicon.svg", "/manifest.webmanifest", "/sw.js",
}

// discardRW : ResponseWriter minimal pour mesurer le coût serveur sans le coût du recorder.
type discardRW struct {
	h      http.Header
	status int
	n      int
}

func (d *discardRW) Header() http.Header         { return d.h }
func (d *discardRW) WriteHeader(code int)        { d.status = code }
func (d *discardRW) Write(p []byte) (int, error) { d.n += len(p); return len(p), nil }

func newEmbedServer(tb testing.TB) *server {
	root, err := fs.Sub(webEmbed, "web")
	if err != nil {
		tb.Fatal(err)
	}
	return newServer(root)
}

func serve(s *server, path string, hdr map[string]string) *discardRW {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := &discardRW{h: make(http.Header)}
	s.ServeHTTP(w, req)
	return w
}

// Chargement complet du shell, sans cache client (1re visite).
func BenchmarkShellCold(b *testing.B) {
	s := newEmbedServer(b)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		for _, p := range shellPaths {
			if w := serve(s, p, nil); w.status != 200 {
				b.Fatalf("%s: status %d", p, w.status)
			}
		}
	}
}

// Rechargement avec validateurs (If-None-Match / If-Modified-Since) tels que renvoyés par le serveur.
// Sans ETag ni Last-Modified côté serveur, revient à ShellCold (200 pleins).
func BenchmarkShellRevalidate(b *testing.B) {
	s := newEmbedServer(b)
	cond := make([]map[string]string, len(shellPaths))
	var bytes304, bytes200 int
	for i, p := range shellPaths {
		w := serve(s, p, nil)
		h := map[string]string{}
		if et := w.h.Get("ETag"); et != "" {
			h["If-None-Match"] = et
		}
		if lm := w.h.Get("Last-Modified"); lm != "" {
			h["If-Modified-Since"] = lm
		}
		cond[i] = h
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for j, p := range shellPaths {
			w := serve(s, p, cond[j])
			switch w.status {
			case 200:
				bytes200 += w.n
			case 304:
				bytes304++
			default:
				b.Fatalf("%s: status %d", p, w.status)
			}
		}
	}
	b.ReportMetric(float64(bytes200)/float64(b.N), "bodyBytes/load")
	b.ReportMetric(float64(bytes304)/float64(b.N), "304s/load")
}

// Photon : 8 résultats réalistes (le cas nominal d'une recherche).
func photonFixture() []byte {
	var sb strings.Builder
	sb.WriteString(`{"features":[`)
	for i := 0; i < 8; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		fmt.Fprintf(&sb, `{"type":"Feature","geometry":{"type":"Point","coordinates":[%f,%f]},"properties":{"osm_id":%d,"osm_type":"N","osm_key":"place","osm_value":"village","name":"Coulonges %d","postcode":"16330","city":"Coulonges","county":"Charente","state":"Nouvelle-Aquitaine","country":"France","countrycode":"FR","extent":[0.08,45.84,0.10,45.82]}}`,
			0.09+float64(i)*0.01, 45.83+float64(i)*0.01, 1000+i, i)
	}
	sb.WriteString(`]}`)
	return []byte(sb.String())
}

func BenchmarkPhotonToResults(b *testing.B) {
	raw := photonFixture()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := photonToResults(raw); err != nil {
			b.Fatal(err)
		}
	}
}

// Recherche déjà en cache : le chemin chaud de l'autocomplete.
func BenchmarkGeocodeCached(b *testing.B) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(photonFixture())
	}))
	defer ts.Close()
	s := newEmbedServer(b)
	s.photonBase = ts.URL
	if w := serve(s, "/api/geocode?q=Coulonges&lat=45.8&lon=0.09", nil); w.status != 200 {
		b.Fatalf("prime: %d", w.status)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if w := serve(s, "/api/geocode?q=Coulonges&lat=45.8&lon=0.09", nil); w.status != 200 {
			b.Fatalf("status %d", w.status)
		}
	}
}

func BenchmarkLRUGetSet(b *testing.B) {
	c := newLRUCache(512)
	keys := make([]string, 1024)
	for i := range keys {
		keys[i] = fmt.Sprintf("geocode:q%d", i)
	}
	val := []byte(`[{"lat":"45.8","lon":"0.09","display_name":"x"}]`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		k := keys[i%len(keys)]
		if _, _, ok := c.Get(k); !ok {
			c.Set(k, val, "application/json")
		}
	}
}
