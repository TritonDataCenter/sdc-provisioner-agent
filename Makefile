NAME=provisioner
PKG=JOY$(NAME)

VERSION=$(shell git describe)
# The package will be installed into $(BASEDIR)/provisioner
# (BASEDIR is called PREFIX in other package systems)
BASEDIR=/opt

ifeq ($(VERSION), "")
	@echo "Use gmake"
endif


PKGFILE=$(PKG)-$(VERSION).pkg
NODE_PREFIX=$(shell pwd)/local
NODE_WAF=$(NODE_PREFIX)/bin/node-waf

all: $(PKGFILE)

NPM_FILES =                      \
	    etc                  \
	    lib                  \
	    node_modules         \
	    npm-scripts          \
	    package.json         \
	    provisioner-agent.js \
	    scripts              \
	    support              \

TARBALL=$(NAME).tgz
npm: $(TARBALL)

MDNS_DIR=node_modules/.npm/mdns/active/package
MDNS_BINDING=$(MDNS_DIR)/lib/binding.node

$(MDNS_BINDING):
	cd $(MDNS_DIR) && $(NODE_WAF) configure build

submodules:
	git submodule update --init

$(NODE_PREFIX)/bin/node:
	cd node && python tools/waf-light configure --prefix=$(NODE_PREFIX)
	cd node && make install

$(TARBALL): Makefile .npm $(NODE_PREFIX)/bin/node $(MDNS_BINDING) $(NPM_FILES)
	git submodule update --init
	rm -fr .npm
	mkdir -p .npm/$(NAME)/
	cd node && make install
	cp -Pr $(NPM_FILES) $(NODE_PREFIX) .npm/$(NAME)/
	cd .npm && gtar zcvf ../$(TARBALL) $(NAME)

.npm:
	mkdir -p $(NODE_PREFIX)

$(PKGFILE): Makefile .pkg/provisioner.xml .pkg/pkginfo .pkg/local build/ provisioner-agent.js $(MDNS_BINDING)
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

.pkg/local: .pkg
	cd node && python tools/waf-light configure --prefix=$(NODE_PREFIX)
	cd node && make install


distclean:
	-cd node; make distclean
	-rm -rf .pkg/ .npm/ $(TARBALL)
	-rm $(PKG)-*.pkg

clean:
	-rm -rf .pkg/ .npm/ $(TARBALL)
	-rm $(PKG)-*.pkg

.PHONY: clean distclean npm
