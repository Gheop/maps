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

## Bascule nginx publique : voir le plan front (étape finale).
