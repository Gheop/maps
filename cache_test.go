package main

import "testing"

func TestCacheSetGet(t *testing.T) {
	c := newLRUCache(2)
	c.Set("a", []byte("av"), "text/plain")
	v, ct, ok := c.Get("a")
	if !ok || string(v) != "av" || ct != "text/plain" {
		t.Fatalf("got %q %q %v", v, ct, ok)
	}
}

func TestCacheMiss(t *testing.T) {
	c := newLRUCache(2)
	if _, _, ok := c.Get("nope"); ok {
		t.Fatal("expected miss")
	}
}

func TestCacheOverwrite(t *testing.T) {
	c := newLRUCache(2)
	c.Set("a", []byte("1"), "")
	c.Set("a", []byte("2"), "text/x")
	v, ct, ok := c.Get("a")
	if !ok || string(v) != "2" || ct != "text/x" {
		t.Fatalf("got %q %q %v", v, ct, ok)
	}
	// The overwrite must not create a duplicate entry. With max=2, both
	// "a" and "b" must remain present after adding "b".
	c.Set("b", []byte("3"), "")
	if _, _, ok := c.Get("a"); !ok {
		t.Fatal("a should still be present after overwrite + add")
	}
	if _, _, ok := c.Get("b"); !ok {
		t.Fatal("b should be present")
	}
}

func TestCacheZeroMax(t *testing.T) {
	c := newLRUCache(0) // clamps to 1
	c.Set("a", []byte("1"), "")
	c.Set("b", []byte("2"), "")
	if _, _, ok := c.Get("a"); ok {
		t.Fatal("a should have been evicted")
	}
	if _, _, ok := c.Get("b"); !ok {
		t.Fatal("b should be present")
	}
}

func TestCacheEviction(t *testing.T) {
	c := newLRUCache(2)
	c.Set("a", []byte("1"), "")
	c.Set("b", []byte("2"), "")
	_, _, _ = c.Get("a") // a becomes most recent
	c.Set("c", []byte("3"), "") // must evict b (oldest)
	if _, _, ok := c.Get("b"); ok {
		t.Fatal("b should have been evicted")
	}
	if _, _, ok := c.Get("a"); !ok {
		t.Fatal("a should still be present")
	}
	if _, _, ok := c.Get("c"); !ok {
		t.Fatal("c should be present")
	}
}
