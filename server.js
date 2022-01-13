require('dotenv').config();

const express = require('express');
const yaml = require('yaml');
const DockerEvents = require('docker-events2');
const Docker = require('dockerode');
const Handlebars = require('handlebars');
const fs = require('fs');
const chokidar = require('chokidar');
const shelljs = require('shelljs');

var certificates;

const pkg = require('./package.json');
const settings = require('./settings.json');

var app = express();

var docker = new Docker();
if (!process.env['MANAGED_DOMAINS']) process.env['MANAGED_DOMAINS'] = [];
var domains = [];
var HOSTS = {};

function model(name, config, output, cb) {
    fs.readFile(__dirname + '/tpl/' + name + '.conf', 'utf-8', function(e, r) {
        var tpl = Handlebars.compile(r);
        var out = tpl(config);
        fs.unlink(output, function() {
            fs.writeFile(output, out, function(e) {
                if (e) return cb(e);
                cb(null, out);
            });
        });
    });
}

var dir_nginx = '/etc/nginx';
var dir_certs = '/etc/certs';
var dir_offline = '/var/offline';
var dir_www = '/var/www';

/*
var dir_nginx = '/datastore/omneedia-core-web_etc';
var dir_certs = '/datastore/omneedia-core-web_certs';
var dir_offline = '/datastore/omneedia-core-web_offline';
var dir_www = '/datastore/omneedia-core-web_www';
*/

console.log(`\n ** Starting omneedia ingress controller v${pkg.version}\n`);

var emitter = new DockerEvents({
    docker: docker,
});
emitter.start();

function is_managed_domain(domain) {
    // get last part of a domain
    for (var el in certificates.domains.managed) {
        var provider = el;
        var domains = certificates.domains.managed[el];
        for (var i = 0; i < domains.length; i++) {
            if (domain.indexOf(domains[i]) > -1) return domains[i];
        }
    }
    return false;
}

function get_cert_creds(domain) {
    for (var el in certificates.domains.managed) {
        var provider = el;
        var domains = certificates.domains.managed[el];
        for (var i = 0; i < domains.length; i++) {
            if (domain.indexOf(domains[i]) > -1) return certificates.credentials[el];
        }
    }
    return false;
}

function get_cert_provider(domain) {
    for (var el in certificates.domains.managed) {
        var provider = el;
        var domains = certificates.domains.managed[el];
        for (var i = 0; i < domains.length; i++) {
            if (domain.indexOf(domains[i]) > -1) return el;
        }
    }
    return false;
}

function check_cert(d, cb) {
    fs.stat(dir_certs + '/live/' + d, function(e, s) {
        if (e) {
            // create certificate for ...
            if (is_managed_domain(d)) {
                // managed domain
                var cmd = Handlebars.compile(settings.cloudflare);
                var creds = get_cert_creds(d);
                cmd = cmd({
                    dir_certs: dir_certs + ':/etc/letsencrypt',
                    domain: d,
                    login: creds.login,
                    email: certificates.domains.email,
                    api_key: creds.api_key,
                });
                shelljs.exec(
                    cmd, {
                        silent: false,
                    },
                    function(e, r) {
                        if (e == 0) return cb(true);
                        else return cb(false);
                    }
                );
            } else {
                // ... and unmanaged domain
                var cmd = Handlebars.compile(settings.unmanaged);
                if (!certificates.domains.email)
                    certificates.domains.email = 'omneedia.rulez@host.com';
                cmd = cmd({
                    dir_certs: dir_certs + ':/etc/letsencrypt',
                    dir_certbot: dir_www + '/certbot:/var/www/certbot',
                    email: certificates.domains.email,
                    domain: d,
                });
                shelljs.exec(
                    cmd, {
                        silent: false,
                    },
                    function(e, r) {
                        if (e == 0) return cb(true, d);
                        else return cb(false, d);
                    }
                );
            }
        } else {
            // the certificate exists already
            if (is_managed_domain(d)) cb(true);
            else cb(true, d);
        }
    });
}

var update = function(service) {
    var ip = service.Spec.Name;
    var labels = service.Spec.TaskTemplate.ContainerSpec.Labels;
    var hosts = labels.hosts.split(' ');

    function deploy(host, ndx, cb) {
        if (!host[ndx]) return cb();
        var vhost = host[ndx].split(':')[0];
        var port = host[ndx].split(':')[1];
        console.log(' > registering ' + vhost);
        var protocol = 'http';
        if (vhost.indexOf('!') > -1) {
            protocol = 'https';
            vhost = vhost.split('!')[1];
        }

        if (is_managed_domain(vhost)) {
            var filename = 'nginx-ssl';
            var my_domain = is_managed_domain(vhost);
        } else {
            var filename = 'nginx-ssl-temp';
            var my_domain = vhost;
        }

        model(
            filename, {
                vhost: vhost,
                port: port,
                ip: ip,
                protocol: protocol,
                domain: my_domain,
            },
            dir_nginx + '/sites-enabled/' + vhost + '.conf',
            function() {
                check_cert(my_domain, function(o, domain) {
                    if (domain) {
                        // unmanaged domain
                        if (certificates.domains.unmanaged.indexOf(domain) == -1) {
                            certificates.domains.unmanaged.push(domain);
                            updateCertificates();
                        }
                        var filename = 'nginx-ssl';
                        model(
                            filename, {
                                vhost: vhost,
                                port: port,
                                ip: ip,
                                protocol: protocol,
                                domain: my_domain,
                            },
                            dir_nginx + '/sites-enabled/' + vhost + '.conf',
                            function() {
                                deploy(host, ndx + 1, cb);
                            }
                        );
                    } else {
                        var provider = get_cert_provider(vhost);
                        var zi_host = is_managed_domain(vhost);
                        if (certificates.domains.managed[provider].indexOf(zi_host) == -1) {
                            certificates.domains.managed[provider].push(zi_host);
                            updateCertificates();
                        }
                        cb();
                    }
                });
            }
        );
    }
    deploy(hosts, 0, function() {
        var o = {};
        if (labels.title) o.title = labels.title;
        else o.title = hosts[0].split(':')[0];
        if (labels.icon) o.icon = labels.icon;
        else o.icon = '/offline/cloud.png';
        fs.mkdir(dir_offline + '/' + hosts[0].split(':')[0], function() {
            model(
                'web-offline',
                o,
                dir_offline + '/' + hosts[0].split(':')[0] + '/index.html',
                function() {
                    console.log(` > ${hosts.join(',')} deployed.`);
                }
            );
        });
    });
};

app.use('/offline', express.static(__dirname + '/tpl/offline'));

function updateCertificates() {
    fs.writeFile(
        dir_nginx + '/certs.yml',
        yaml.stringify(certificates),
        function() {}
    );
}

function readCertificates(cb) {
    fs.readFile(dir_nginx + '/certs.yml', 'utf-8', function(e, r) {
        certificates = yaml.parse(r);
        cb();
    });
}

function create_default_page(vhosts, ndx) {
    if (!vhosts[ndx]) return;
    fs.stat(
        dir_nginx + '/sites-enabled/_.' + vhosts[ndx] + '.conf',
        function(e, s) {
            if (s) return create_default_page(vhosts, ndx + 1);
            check_cert(vhosts[ndx], function() {
                model(
                    'nginx-default', {
                        domain: vhosts[ndx],
                        root: '/var/www',
                    },
                    dir_nginx + '/sites-enabled/_.' + vhosts[ndx] + '.conf',
                    function() {
                        create_default_page(vhosts, ndx + 1);
                    }
                );
            });
        }
    );
}

function updateCertConfig(init) {
    if (init) {
        try {
            certificates = yaml.parse(
                fs.readFileSync(dir_nginx + '/certs.yml', 'utf-8')
            );
        } catch (e) {
            certificates = {
                credentials: {
                    cloudflare: {
                        login: '',
                        api_key: '',
                    },
                },
                domains: {
                    email: 'awesome.omneedia@host.com',
                    managed: {
                        cloudflare: [],
                    },
                    unmanaged: [],
                },
            };
            updateCertificates();
        }

        var vhosts = [];
        for (var el in certificates.domains.managed) {
            for (var i = 0; i < certificates.domains.managed[el].length; i++)
                vhosts.push(certificates.domains.managed[el][i]);
        }
        create_default_page(vhosts, 0);

        emitter.on('*', function(message) {
            if (message.status == 'destroy') {
                var labels = message.actor.Attributes;
                var vhost = labels.hosts.split(' ')[0].split(':')[0];
                if (is_managed_domain(vhost)) var domain = is_managed_domain(vhost);
                else var domain = vhost;
                model(
                    'nginx-offline', {
                        vhost: vhost,
                        domain: domain,
                        root: '/var/offline/' + vhost,
                    },
                    dir_nginx + '/sites-enabled/' + vhost + '.conf',
                    function() {
                        console.log(' - ' + domain + ' removed.');
                    }
                );
            }
            if (message.type == 'service') {
                if (message.action == 'create') {
                    var service = docker.getService(message.actor.ID);
                    service.inspect(service.ID).then(function(info) {
                        var labels = info.Spec.TaskTemplate.ContainerSpec.Labels;
                        if (labels.hosts) {
                            HOSTS[info.id] = info;
                            update(info);
                        }
                    });
                }
            }
        });

        docker.listServices().then(function(services) {
            for (var i = 0; i < services.length; i++) {
                var service = services[i];

                service = docker.getService(service.ID);

                service.inspect(service.id).then(function(info) {
                    var labels = info.Spec.TaskTemplate.ContainerSpec.Labels;
                    if (labels.hosts) {
                        HOSTS[info.id] = info;
                        update(info);
                    }
                });
            }
        });
    } else {
        fs.readFile(dir_nginx + '/certs.yml', 'utf-8', function(e, r) {
            if (e) {
                var certificates = {
                    credentials: {
                        cloudflare: {
                            login: '',
                            api_key: '',
                        },
                    },
                    domains: {
                        email: 'awesome.omneedia@host.com',
                        managed: {
                            cloudflare: [],
                        },
                        unmanaged: [],
                    },
                };
                updateCertificates();
            } else var certificates = yaml.parse(r);

            var vhosts = [];
            for (var el in certificates.domains.managed) {
                for (var i = 0; i < certificates.domains.managed[el].length; i++)
                    vhosts.push(certificates.domains.managed[el][i]);
            }
            create_default_page(vhosts, 0);
            //console.log(r);
        });
    }
}

updateCertConfig(true);

chokidar
    .watch(dir_nginx + '/certs.yml', {
        persistent: true,

        ignored: '*.txt',
        ignoreInitial: true,
        followSymlinks: true,
        cwd: '.',
        disableGlobbing: false,

        usePolling: false,
        interval: 100,
        binaryInterval: 300,
        alwaysStat: false,
        depth: 99,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
        },

        ignorePermissionErrors: false,
        atomic: true, // or a custom 'atomicity delay', in milliseconds (default 100)
    })
    .on('all', (event, path) => {
        console.log(' * cert updated...');
        updateCertConfig();
    });

app.listen(8000, function() {
    console.log(' - server started.\n');
});