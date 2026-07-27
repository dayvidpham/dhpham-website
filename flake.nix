{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = inputs@{ self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodePkg = pkgs.nodejs_24;
        pnpmPkg = pkgs.pnpm.overrideAttrs {
          nodejs = nodePkg;
        };

        buildInputs = [
          nodePkg
          pnpmPkg
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = buildInputs ++ [ pkgs.chromium ];
          shellHook = ''
            echo "node `node --version`"
            echo "npm `npm --version`"
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            export PATH="$(pwd)/node_modules/.bin:$PATH"
          '';
        };

        packages.default = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
            pname = "dhpham-website";
            version = "0.2.0";
            src = ./.;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              pnpm = pnpmPkg;
              fetcherVersion = 3;
              hash = "sha256-VxAFJsqr/2qHScPiLLXl6Kp0njV21m91z2WjmisScoA=";
            };

            nativeBuildInputs = [
              nodePkg
              pnpmPkg
              pkgs.pnpmConfigHook
            ];

            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r dist/. $out/
              runHook postInstall
            '';
          });
      });
}
