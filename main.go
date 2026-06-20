package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"
)

//go:embed web
var webEmbed embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	webRoot, err := fs.Sub(webEmbed, "web")
	if err != nil {
		log.Fatalf("embed web: %v", err)
	}
	s := newServer(webRoot)
	hs := &http.Server{
		Addr:              ":" + port,
		Handler:           s,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("maps listening on :%s", port)
	log.Fatal(hs.ListenAndServe())
}
