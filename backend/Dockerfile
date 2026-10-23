ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0
ARG DOTNET_RUNTIME_IMAGE=mcr.microsoft.com/dotnet/aspnet:10.0
FROM ${DOTNET_SDK_IMAGE} AS build
WORKDIR /src
COPY backend/LoveCloud.Api.csproj backend/packages.lock.json ./
RUN dotnet restore --locked-mode
COPY backend/ .
ARG VERSION=0.1.0
RUN dotnet publish -c Release -o /out --no-restore /p:Version=${VERSION}

FROM ${DOTNET_RUNTIME_IMAGE} AS runtime
ARG VERSION=0.1.0
ARG REVISION=development
LABEL org.opencontainers.image.title="LoveCloud API" \
      org.opencontainers.image.source="https://github.com/m0rp3x/LoveCloud" \
      org.opencontainers.image.revision=${REVISION} \
      org.opencontainers.image.version=${VERSION} \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
RUN mkdir -p /data/files /data/keys && chown -R app:app /data
COPY --from=build /out ./
COPY LICENSE NOTICE THIRD_PARTY_NOTICES /usr/share/licenses/lovecloud/
COPY licenses/ /usr/share/licenses/lovecloud/licenses/
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "LoveCloud.Api.dll"]
