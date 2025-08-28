# Build stage
FROM golang:1.23 AS build
WORKDIR /app

# copy source
COPY . .

# create module if it doesn't exist, tidy deps, build
RUN (test -f go.mod || go mod init example.com/dispatch) \
 && go mod tidy \
 && go build -o dispatch

# Runtime stage (small image)
FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /app/dispatch .
EXPOSE 8080
CMD ["./dispatch"]
