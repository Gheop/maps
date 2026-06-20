# Déploiement

## Build + import (sur gheop.com)

    rsync -az --delete --exclude='.git' ./ gheop.com:~/src/maps/
    ssh gheop.com 'cd ~/src/maps && docker build -f deploy/Dockerfile -t maps:local . && docker save maps:local | sudo k3s ctr images import -'

## Appliquer

    sudo kubectl apply -f deploy/k8s/namespace.yaml
    sudo kubectl apply -f deploy/k8s/deployment.yaml
    sudo kubectl apply -f deploy/k8s/service.yaml
    sudo kubectl apply -f deploy/k8s/ingress.yaml
    sudo kubectl -n maps rollout status deploy/maps

## Vérif interne (sans bascule publique)

    curl -H "Host: maps.gheop.com" http://127.0.0.1:30800/healthz

## Redéploiement après changement d'image

    # après build + import :
    sudo kubectl -n maps rollout restart deploy/maps

## Tuiles

Aucun secret : les tuiles sont chargées en direct par le navigateur. Stadia
(Toner/Aquarelle) est autorisé par domain auth `*.gheop.com` (via le Referer).

## Bascule nginx publique (faite le 2026-06-20)

`maps.gheop.com` est servi par nginx (hôte) qui termine le TLS et proxie vers
Traefik. Les deux blocs `server { … maps.gheop.com … root /www/maps … }` de
`/etc/nginx/nginx.conf` ont été remplacés par :

    server {
        server_name maps.gheop.com map.gheop.com;
        listen 80;
        return 301 https://maps.gheop.com$request_uri;
    }
    server {
        server_name maps.gheop.com;
        listen 443 ssl;
        http2 on;
        gzip on;
        ssl_certificate     /etc/letsencrypt/live/maps.gheop.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/maps.gheop.com/privkey.pem;
        location / {
            proxy_pass http://127.0.0.1:30800;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

Appliquer (sudo requis, non NOPASSWD pour nginx sur cet hôte) :

    sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-maps-cutover-20260620
    sudo cp /tmp/nginx.conf.new /etc/nginx/nginx.conf   # conf éditée
    sudo nginx -t && sudo nginx -s reload

Rollback :

    sudo cp /etc/nginx/nginx.conf.bak-maps-cutover-20260620 /etc/nginx/nginx.conf
    sudo nginx -s reload

Le `Referer` reste `https://maps.gheop.com/` (Referrer-Policy `strict-origin-when-cross-origin`),
indispensable pour l'auth par domaine Stadia. L'ancien `/www/maps` (php) reste en
place mais n'est plus servi.
