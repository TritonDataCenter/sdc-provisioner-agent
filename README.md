<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# sdc-provisioner-agent

This repository is part of the Joyent SmartDataCenter project (SDC).  For
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.


# Overview

sdc-provisioner-agent is an RPC service via which a client can interact with
a compute node. It acts as an externally visible interface to subsystems
within the server.

Provisioner is responsible for executing "tasks", which are simply scripts
which break down some unit of work into a number of steps to be completed.
This may be may range from creating a virtual machine to something as simple
as creating or listing ZFS datasets.


# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    lib/            Source files.
    node_modules/   Node.js deps, either populated at build time or commited.
                    See Managing Dependencies.
    pkg/            Package lifecycle scripts
    smf/manifests   SMF manifests
    smf/methods     SMF method scripts
    test/           Test suite (using node-tap)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run the provisioner agent:

    git clone git@github.com:joyent/sdc-provisioner-agent.git
    cd sdc-provisioner-agent
    git submodule update --init
