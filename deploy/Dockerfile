FROM golang:1.23-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /maps .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /maps /maps
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/maps"]
