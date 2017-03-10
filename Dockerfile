FROM alpine:latest

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

RUN touch /crontab.tmp \
    && echo '2 0 * * * echo "Test Test"' >> /crontab.tmp \
    && crontab /crontab.tmp \
    && rm -rf /crontab.tmp

CMD ["/usr/sbin/crond", "-f", "-d", "0"]

