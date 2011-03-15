NAME=provisioner
PKG=JOY$(NAME)

VERSION=$(shell git describe)
# The package will be installed into $(BASEDIR)/provisioner
# (BASEDIR is called PREFIX in other package systems)
BASEDIR=/opt

ifeq ($(VERSION), "")
	@echo "Use gmake"
endif

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

distclean:
	-cd node; make distclean
	-rm -rf .npm/ $(TARBALL)

clean:
	-rm -rf  .npm/ $(TARBALL)

# Test-related targets

start:
	./test-env.sh $(NODE_PATH) provisioner-agent.js

test:
	./test-env.sh $(NODE_PATH) junit-tests.js

.PHONY: clean distclean npm
