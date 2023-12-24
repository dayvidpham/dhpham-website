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
        };
    });
}
