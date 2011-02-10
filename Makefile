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
NODE_PATH=$(shell pwd)/local/bin/node
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

node: $(NODE_PATH)

submodules:
	git submodule update --init

$(NODE_PREFIX)/bin/node: submodules
	cd node && python tools/waf-light configure --prefix=$(NODE_PREFIX)
	cd node && CC=gcc make install

$(TARBALL): Makefile .npm $(NODE_PATH) $(NPM_FILES)
	rm -fr .npm
	mkdir -p .npm/$(NAME)/
	cd node && CC=gcc gmake install
	cp -Pr $(NPM_FILES) $(NODE_PREFIX) .npm/$(NAME)/
	cd .npm && gtar zcvf ../$(TARBALL) $(NAME)

.npm:
	mkdir -p $(NODE_PREFIX)

prototype:
	./build/update_node_modules_prototype.sh

$(PKGFILE): Makefile .pkg/provisioner.xml .pkg/pkginfo $(NODE_PATH) build/ provisioner-agent.js prototype
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

distclean:
	-cd node; make distclean
	-rm -rf .pkg/ .npm/ $(TARBALL)
	-rm $(PKG)-*.pkg

clean:
	-rm -rf .pkg/ .npm/ $(TARBALL)
	-rm $(PKG)-*.pkg

# Test-related targets

start:
	./test-env.sh $(NODE_PATH) provisioner-agent.js

test:
	./test-env.sh $(NODE_PATH) junit-tests.js

.PHONY: clean distclean npm
