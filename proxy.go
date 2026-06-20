package main

import (
	"fmt"
	"io"
	"net/http"
)

const userAgent = "gheop-maps/1.0 (+https://maps.gheop.com)"

const maxUpstreamBytes = 4 << 20 // 4 MiB

func (s *server) upstreamGet(url string) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUpstreamBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(body) > maxUpstreamBytes {
		return nil, "", fmt.Errorf("upstream response too large")
	}
	return body, resp.Header.Get("Content-Type"), nil
}
