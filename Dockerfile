FROM mhart/alpine-node-auto:7.7

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

RUN touch /crontab.tmp \
    && echo '2 0 * * * echo "Test Test"' >> /crontab.tmp \
    && crontab /crontab.tmp \
    && rm -rf /crontab.tmp \
    && git clone https://github.com/aditosoftware/nodebackup.git \
    && cd /nodebackup && npm install

COPY run.sh /run.sh

CMD ["/run.sh"]