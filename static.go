package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Assets embarqués : embed.FS n'a pas de date de modification, donc http.FileServer
// seul n'émet ni Last-Modified ni ETag et chaque visite retélécharge tout le shell.
// On calcule un ETag par contenu au démarrage (le binaire est immuable) et on force
// la revalidation (no-cache) : les revisites font des 304 sans corps.
func newStaticHandler(root fs.FS) http.Handler {
	etags := make(map[string]string)
	_ = fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		etags["/"+p] = `"` + hex.EncodeToString(sum[:8]) + `"`
		return nil
	})
	files := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean("/" + r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/") {
			p = strings.TrimSuffix(p, "/") + "/index.html"
		}
		if et, ok := etags[p]; ok {
			w.Header().Set("ETag", et)
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r) // gère If-None-Match -> 304 à partir de l'ETag posé ci-dessus
	})
}
