#!/bin/bash

#create ssmtp configuration file
echo "root=$SSMTP_SENDER_ADDRESS" > /etc/ssmtp/ssmtp.conf

# The place where the mail goes. The actual machine name is required no 
# MX records are consulted. Commonly mailhosts are named mail.domain.com
echo "mailhub=$SSMTP_MAIL_SERVER" >> /etc/ssmtp/ssmtp.conf

# The full hostname
echo "hostname=$SSMTP_HOST" >> /etc/ssmtp/ssmtp.conf

# Use STARTTLS
echo "UseSTARTTLS=YES" >> /etc/ssmtp/ssmtp.conf

#Create Cron job
crontab /crontab.tmp && /usr/sbin/crond -L /var/log/crond.log -f -d 0