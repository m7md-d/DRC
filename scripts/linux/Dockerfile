# Build on Debian 12 so the resulting glibc requirement has a known baseline.
FROM node:22-bookworm-slim AS node
FROM rust:slim-bookworm AS build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev librsvg2-dev patchelf libtsk-dev sleuthkit gddrescue smartmontools usbutils pciutils udev lzip curl ca-certificates python3 && rm -rf /var/lib/apt/lists/*
RUN rustup component add clippy rustfmt
WORKDIR /work
ENV CARGO_BUILD_JOBS=2
COPY . .
RUN npm ci
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/work/src-tauri/target,sharing=locked npm test && npm run rust:test && npm run rust:check && python3 scripts/linux/test-faults.py && npm run desktop:build:linux && mkdir /deliverables && cp "src-tauri/target/release/bundle/deb/DRC_$(node -p 'require("./package.json").version')_$(dpkg --print-architecture).deb" /deliverables/ && cp scripts/linux/install-debian.sh docs/LINUX-INSTALL.md .cache/linux-fault-results.json /deliverables/ && cd /deliverables && sha256sum *.deb > SHA256SUMS
FROM scratch AS artifacts
COPY --from=build /deliverables/ /

# Fresh runtime image: verify the installer and packaged tools without development headers.
FROM debian:bookworm-slim AS install-check
COPY --from=build /deliverables/*.deb /tmp/packages/
RUN apt-get update && apt-get install -y --no-install-recommends /tmp/packages/*.deb && rm -rf /var/lib/apt/lists/*
RUN /usr/bin/drc-ddrescue --version && /usr/bin/drc-tsk --version && ldd /usr/bin/drc-tsk | grep '/usr/bin/../lib/drc/' && dpkg-query -W drc

FROM debian:bookworm-slim AS kernel-tests
RUN apt-get update && apt-get install -y --no-install-recommends python3 util-linux e2fsprogs && rm -rf /var/lib/apt/lists/*
COPY scripts/linux/test-kernel-claim.py /test-kernel-claim.py
CMD ["python3", "/test-kernel-claim.py"]
