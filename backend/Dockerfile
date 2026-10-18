FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY LoveCloud.Api.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
RUN mkdir -p /data/files /data/keys && chown -R app:app /data
COPY --from=build /out ./
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "LoveCloud.Api.dll"]
