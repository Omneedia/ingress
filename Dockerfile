FROM ubuntu:20.04

LABEL maintainer="Stephane Zucatti"
LABEL version="1.0.0"
LABEL description="Omneedia ingress controller"

RUN apt update && apt install -y curl git
RUN curl -sL https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get install -y nodejs

EXPOSE 8000

# Install Docker from Docker Inc. repositories.
RUN curl -sSL https://get.docker.com/ | sh
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/
WORKDIR /usr/src/
COPY . /usr/src/

RUN npm install .

CMD ["node", "server"]
