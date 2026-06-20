package main

import (
	"container/list"
	"sync"
)

type cacheEntry struct {
	key   string
	value []byte
	ctype string
}

type lruCache struct {
	mu    sync.Mutex
	max   int
	ll    *list.List
	items map[string]*list.Element
}

func newLRUCache(max int) *lruCache {
	if max < 1 {
		max = 1
	}
	return &lruCache{
		max:   max,
		ll:    list.New(),
		items: make(map[string]*list.Element),
	}
}

func (c *lruCache) Get(key string) ([]byte, string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.ll.MoveToFront(el)
		e := el.Value.(*cacheEntry)
		return e.value, e.ctype, true
	}
	return nil, "", false
}

func (c *lruCache) Set(key string, value []byte, ctype string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.ll.MoveToFront(el)
		e := el.Value.(*cacheEntry)
		e.value, e.ctype = value, ctype
		return
	}
	el := c.ll.PushFront(&cacheEntry{key: key, value: value, ctype: ctype})
	c.items[key] = el
	if c.ll.Len() > c.max {
		back := c.ll.Back()
		if back != nil {
			c.ll.Remove(back)
			delete(c.items, back.Value.(*cacheEntry).key)
		}
	}
}
