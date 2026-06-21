package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Réponse Photon (GeoJSON). On n'extrait que ce qui nous sert.
type photonResponse struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"` // [lon, lat]
		} `json:"geometry"`
		Properties struct {
			Name     string    `json:"name"`
			City     string    `json:"city"`
			County   string    `json:"county"`
			State    string    `json:"state"`
			Country  string    `json:"country"`
			Extent   []float64 `json:"extent"` // [minLon, maxLat, maxLon, minLat], optionnel
		} `json:"properties"`
	} `json:"features"`
}

// Format renvoyé au front (compatible Nominatim : lat/lon en chaînes, boundingbox [sud, nord, ouest, est]).
type geoResult struct {
	Lat         string   `json:"lat"`
	Lon         string   `json:"lon"`
	DisplayName string   `json:"display_name"`
	Boundingbox []string `json:"boundingbox,omitempty"`
}

func (s *server) handleGeocode(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeJSONError(w, http.StatusBadRequest, `{"error":"missing or invalid q"}`)
		return
	}
	key := "geocode:" + q // le biais position n'affecte que le 1er appel non caché
	if body, ctype, ok := s.cache.Get(key); ok {
		writeCached(w, body, ctype)
		return
	}
	u := s.photonBase + "/api/?limit=5&lang=fr&q=" + url.QueryEscape(q)
	if lat, lon := r.URL.Query().Get("lat"), r.URL.Query().Get("lon"); lat != "" && lon != "" {
		if _, e1 := strconv.ParseFloat(lat, 64); e1 == nil {
			if _, e2 := strconv.ParseFloat(lon, 64); e2 == nil {
				u += "&lat=" + url.QueryEscape(lat) + "&lon=" + url.QueryEscape(lon)
			}
		}
	}
	raw, _, err := s.upstreamGet(u)
	if err != nil {
		log.Printf("geocode upstream failed: %v", err)
		writeJSONError(w, http.StatusBadGateway, `{"error":"geocoding upstream failed"}`)
		return
	}
	out, err := photonToResults(raw)
	if err != nil {
		log.Printf("geocode decode failed: %v", err)
		writeJSONError(w, http.StatusBadGateway, `{"error":"geocoding decode failed"}`)
		return
	}
	s.cache.Set(key, out, "application/json")
	writeCached(w, out, "application/json")
}

func photonToResults(raw []byte) ([]byte, error) {
	var pr photonResponse
	if err := json.Unmarshal(raw, &pr); err != nil {
		return nil, err
	}
	results := make([]geoResult, 0, len(pr.Features))
	for _, f := range pr.Features {
		if len(f.Geometry.Coordinates) < 2 {
			continue
		}
		p := f.Properties
		res := geoResult{
			Lat:         strconv.FormatFloat(f.Geometry.Coordinates[1], 'f', 7, 64),
			Lon:         strconv.FormatFloat(f.Geometry.Coordinates[0], 'f', 7, 64),
			DisplayName: photonLabel(p.Name, p.City, p.County, p.State, p.Country),
		}
		if len(p.Extent) == 4 {
			// Photon extent [minLon, maxLat, maxLon, minLat] -> Nominatim boundingbox [sud, nord, ouest, est]
			res.Boundingbox = []string{
				strconv.FormatFloat(p.Extent[3], 'f', 7, 64), // sud  = minLat
				strconv.FormatFloat(p.Extent[1], 'f', 7, 64), // nord = maxLat
				strconv.FormatFloat(p.Extent[0], 'f', 7, 64), // ouest = minLon
				strconv.FormatFloat(p.Extent[2], 'f', 7, 64), // est  = maxLon
			}
		}
		results = append(results, res)
	}
	return json.Marshal(results)
}

// Construit un libellé lisible sans doublon (ex : "Coulonges, Charente, France").
func photonLabel(name, city, county, state, country string) string {
	var parts []string
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		for _, e := range parts {
			if e == v {
				return
			}
		}
		parts = append(parts, v)
	}
	add(name)
	if city != "" {
		add(city)
	} else {
		add(county)
	}
	add(state)
	add(country)
	return strings.Join(parts, ", ")
}
