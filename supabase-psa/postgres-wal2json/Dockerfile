FROM postgres:16-alpine AS builder

RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories \
  && apk add --no-cache build-base ca-certificates git

RUN git clone --depth 1 --branch wal2json_2_6 https://github.com/eulerto/wal2json.git /tmp/wal2json

WORKDIR /tmp/wal2json
RUN make with_llvm=no && make with_llvm=no install

FROM postgres:16-alpine

COPY --from=builder /usr/local/lib/postgresql/wal2json.so /usr/local/lib/postgresql/wal2json.so
