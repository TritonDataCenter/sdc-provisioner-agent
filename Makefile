PKG=JOYprovisioner

VERSION=$(shell git describe)
# The package will be installed into $(BASEDIR)/provisioner
# (BASEDIR is called PREFIX in other package systems)
BASEDIR=/opt

ifeq ($(VERSION), "")
	@echo "Use gmake"
endif


PKGFILE=$(PKG)-$(VERSION).pkg
NODE_PREFIX=$(shell pwd)/.pkg/local
NODE_WAF=$(NODE_PREFIX)/bin/node-waf

all: $(PKGFILE)

$(PKGFILE): Makefile .pkg/provisioner.xml .pkg/pkginfo .pkg/local build/ provisioner-agent.js .pkg/amqp_agent/mDNS/binding.node
	pkgmk -o -d /tmp -f build/prototype
	touch $(PKGFILE)
	pkgtrans -s /tmp $(PKGFILE) $(PKG)
	rm -r /tmp/$(PKG)
	@echo
	@echo
	@echo Now install the package: sudo pkgadd -G -d ./$(PKGFILE) all
	@echo
	@echo

.pkg:
	mkdir .pkg

.pkg/provisioner.xml: .pkg build/provisioner.xml.in
	gsed -e "s#@@BASEDIR@@#$(BASEDIR)#g" \
		-e "s/@@VERSION@@/$(VERSION)/g" \
		build/provisioner.xml.in > .pkg/provisioner.xml

.pkg/pkginfo: .pkg build/pkginfo.in
	gsed -e "s#@@BASEDIR@@#$(BASEDIR)#g" \
		-e "s/@@VERSION@@/$(VERSION)/" \
		build/pkginfo.in > .pkg/pkginfo

.pkg/amqp_agent/mDNS/binding.node: .pkg
	cd amqp_agent/mDNS && $(NODE_WAF) configure build

.pkg/local: .pkg
	cd node && python tools/waf-light configure --prefix=$(NODE_PREFIX)
	cd node && make install

distclean:
	-cd node; make distclean
	-rm -rf .pkg/
	-rm $(PKG)-*.pkg

clean:
	-rm -rf .pkg/
	-rm $(PKG)-*.pkg

.PHONY: clean distclean
