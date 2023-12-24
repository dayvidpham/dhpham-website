{
    inputs = {
        nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
        flake-utils.url = "github:numtide/flake-utils";
    };

    outputs = inputs@{ self, nixpkgs, flake-utils, ... }: 
    flake-utils.lib.eachDefaultSystem (system:
    let
        pkgs = nixpkgs.legacyPackages.${system};
        nodePkgs = pkgs.nodejs_20.pkgs;
        #node2nix = pkgs.writeShellScriptBin "node2nix" ''
        #  ${nodePkgs.node2nix}/bin/node2nix \
        #    --development \
        #    --lock        ./package-lock.json \
        #    --composition ./nix/default.nix \
        #    --output      ./nix/node-packages.nix \
        #    --node-env    ./nix/node-env.nix \
        #'';

        #generated = pkgs.callPackage ./nix { 
        #  pkgs = pkgs; system = system; nodejs = pkgs.nodejs_18;
        #};

        buildInputs = [
          pkgs.nodejs_20
        ];


        # Read the package-lock.json as a Nix attrset
        packageLock = builtins.fromJSON (builtins.readFile (./. + "/package-lock.json"));

        # Create an array of all (meaningful) dependencies
        deps = builtins.attrValues (removeAttrs packageLock.packages [ "" ])
          # ++ builtins.attrValues (removeAttrs (packageLock.dependencies) [ "" ])
        ;

        # Turn each dependency into a fetchurl call
        tarballs = map (p: pkgs.fetchurl { url = p.resolved; hash = p.integrity; }) deps;

        # Write a file with the list of tarballs
        tarballsFile = pkgs.writeTextFile {
          name = "tarballs";
          text = builtins.concatStringsSep "\n" tarballs;
        }; 

    in {
        # inherit (generated) nodeDependencies;

        devShells.default = pkgs.mkShell {
            inherit buildInputs;
            shellHook = ''
              echo "node `node --version`"
              echo "npm `npm --version`"
              # echo "pnpm `pnpm --version`"
            '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
            inherit (packageLock) name version;
            inherit buildInputs;
            src     = ./.;

            buildPhase = ''
              export HOME=$PWD/.home
              export npm_config_cache=$PWD/.npm
              mkdir -p $out/js
              cd $out/js
              cp -r $src/. .
              
              while read package
              do
                echo "caching $package"
                npm cache add "$package"
              done <${tarballsFile}

              npm ci
            '';
            installPhase = ''
              ln -s $out/js/node_modules/.bin $out/bin
            ''; 

            # buildInputs = [ pkgs.nodejs_18 ];
            # buildPhase = ''
            #   ln -s ${generated.nodeDependencies}/lib/node_modules ./node_modules
            #   export PATH="${generated.nodeDependencies}/bin:$PATH"
            #   npm run build
            # '';
            # installPhase = ''
            #   cp -r dist $out/
            # '';

        };
    });
}
