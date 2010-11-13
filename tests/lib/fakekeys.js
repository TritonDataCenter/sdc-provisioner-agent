exports.keys
  = { mastershake: mkKey('mastershake')
    , frylock:     mkKey('frylock')
    , meatwad:     mkKey('meatwad')
    , carl:        mkKey('carl')
    , pickles:     mkKey('pickles')
    , nathan:      mkKey('nathan')
    , murderface:  mkKey('murderface')
    , ignignokt:   mkKey('ignignokt')
    };

function mkKey(name) {
  return "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAs5xKh88/HuL+lr+i3DRUzcpkx5Ebbfq7NZVbjVZiICkhn6oCV60OGFmT5qsC2KTVyilakjU5tFlLSSNLQPbYs+hA2Q5tsrXx9JEUg/pfDQdfFjD2Rqhi3hMg7JUWxr9W3HaUtmnMCyrnJhgjA3RKfiZzY/Fkt8zEmRd8SZio0ypAI1IBTxpeaBQ217YqthKzhYlMh7pj9PIwRh7V0G1yDOCOoOR6SYCdOYYwiAosfFSMA2eMST4pjhnJTvrHMBOSn77lJ1hYPesjfjx/VpWIMYCzcP6mBLWaNGuJAIJMAk2EdNwO6tNoicQOH07ZJ4SbJcw6pv54EICxsaFnv0NZMQ== " + name + "@mjollnir.local";
}
