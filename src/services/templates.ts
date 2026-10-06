/**
 * @file templates.ts
 * @description Template engine for generating service skeletons, interceptors,
 * business features, technical features, API connectors, and configurations.
 * Scans the workspace to auto-detect correct placement directories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pascalCase, camelCase, kebabCase } from "./string-utils";

/**
 * Base interface for template context.
 */
export interface TemplateContext {
  readonly moduleName: string;
  readonly description: string;
  readonly year: number;
}

/**
 * Describes a file that was created or updated by a template generator.
 */
export interface GeneratedFile {
  readonly path: string;
  readonly relativePath: string;
  readonly action: "created" | "updated" | "skipped";
  readonly description: string;
}

/**
 * Result of a multi-file generation operation.
 */
export interface GenerationResult {
  readonly files: GeneratedFile[];
  readonly nextSteps: string[];
}

// ═══════════════════════════════════════════════════════════════
// Workspace Scanner
// ═══════════════════════════════════════════════════════════════

/**
 * Scans the workspace to find standard directories for file placement.
 */
export function scanWorkspaceStructure(workspaceRoot: string): {
  interceptorsDir: string | null;
  coreDir: string | null;
  conversationDir: string | null;
  uiDir: string | null;
  infraDir: string | null;
  businessDir: string | null;
} {
  const tryResolve = (...parts: string[]): string | null => {
    const resolved = path.join(workspaceRoot, ...parts);
    return fs.existsSync(resolved) ? resolved : null;
  };

  return {
    interceptorsDir: tryResolve("orazaka-libs", "orazaka-interceptors"),
    coreDir: tryResolve("orazaka-libs", "orazaka-core"),
    conversationDir: tryResolve("orazaka-apps", "services", "orazaka-conversation-service"),
    uiDir: tryResolve("orazaka-apps", "ui"),
    infraDir: tryResolve("infra"),
    businessDir: tryResolve("orazaka-libs", "orazaka-business"),
  };
}

/**
 * Safely writes a file, creating directories as needed.
 * Returns a GeneratedFile descriptor.
 */
function writeFile(
  filePath: string,
  content: string,
  workspaceRoot: string,
  description: string,
): GeneratedFile {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(filePath);
  if (existed) {
    return {
      path: filePath,
      relativePath: path.relative(workspaceRoot, filePath),
      action: "skipped",
      description: `${description} (already exists)`,
    };
  }

  fs.writeFileSync(filePath, content, "utf-8");
  return {
    path: filePath,
    relativePath: path.relative(workspaceRoot, filePath),
    action: "created",
    description,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Interceptor Template
// ═══════════════════════════════════════════════════════════════

export function generateInterceptor(
  ctx: TemplateContext,
  workspaceRoot: string,
): GenerationResult {
  const name = pascalCase(ctx.moduleName);
  const kebab = kebabCase(ctx.moduleName);
  const pkg = kebab.replace(/-/g, "");
  const files: GeneratedFile[] = [];

  const struct = scanWorkspaceStructure(workspaceRoot);
  const interceptorsBase = struct.interceptorsDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-interceptors");
  const moduleDir = path.join(interceptorsBase, `orazaka-interceptor-${kebab}`);
  const srcMain = path.join(moduleDir, "src", "main", "java", "com", "orazaka", "interceptor", pkg);
  const srcTest = path.join(moduleDir, "src", "test", "java", "com", "orazaka", "interceptor", pkg);

  // pom.xml
  files.push(writeFile(
    path.join(moduleDir, "pom.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.orazaka</groupId>
        <artifactId>orazaka-interceptors</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>

    <artifactId>orazaka-interceptor-${kebab}</artifactId>
    <name>orazaka-interceptor-${kebab}</name>
    <description>${ctx.description}</description>

    <dependencies>
        <dependency>
            <groupId>com.orazaka</groupId>
            <artifactId>orazaka-core</artifactId>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-api</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-autoconfigure</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-context</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-model</artifactId>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter-api</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.assertj</groupId>
            <artifactId>assertj-core</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.mockito</groupId>
            <artifactId>mockito-core</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

</project>
`,
    workspaceRoot,
    "Maven module definition",
  ));

  // Interceptor implementation
  files.push(writeFile(
    path.join(srcMain, `${name}Interceptor.java`),
    `package com.orazaka.interceptor.${pkg};

import com.orazaka.core.application.interceptor.PromptContextInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.advisor.api.AdvisedRequest;
import org.springframework.ai.chat.client.advisor.api.AdvisedResponse;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisorChain;

/**
 * ${name}Interceptor: ${ctx.description}
 *
 * <p>Implements the PromptContextInterceptor SPI to participate in the
 * context-matrix pipeline. Registered via {@link ${name}AutoConfiguration}.
 *
 * @since ${ctx.year}
 */
public final class ${name}Interceptor implements PromptContextInterceptor {

    private static final Logger log = LoggerFactory.getLogger(${name}Interceptor.class);

    @Override
    public AdvisedResponse aroundCall(final AdvisedRequest request, final CallAroundAdvisorChain chain) {
        log.debug("${name}Interceptor: processing request");

        // TODO: Implement interception logic
        // Example: modify the request before passing to the next interceptor
        // AdvisedRequest enriched = AdvisedRequest.from(request)
        //     .withSystemText(request.systemText() + "\\n[${name} context]")
        //     .build();

        return chain.nextAroundCall(request);
    }

    @Override
    public String getName() {
        return "${name}Interceptor";
    }

    @Override
    public int getOrder() {
        return 50; // TODO: Adjust ordering per context-matrix table
    }
}
`,
    workspaceRoot,
    "Interceptor implementation (PromptContextInterceptor SPI)",
  ));

  // Auto-configuration
  files.push(writeFile(
    path.join(srcMain, `${name}AutoConfiguration.java`),
    `package com.orazaka.interceptor.${pkg};

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Spring Boot auto-configuration for the ${kebab} interceptor module.
 *
 * <p>Registers {@link ${name}Interceptor} into the application context
 * for dynamic pipeline discovery via SPI.
 *
 * @since ${ctx.year}
 */
@AutoConfiguration
public class ${name}AutoConfiguration {

    @Bean
    ${name}Interceptor ${camelCase(ctx.moduleName)}Interceptor() {
        return new ${name}Interceptor();
    }
}
`,
    workspaceRoot,
    "Spring Boot auto-configuration (SPI registration)",
  ));

  // META-INF/spring.factories or spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
  const importsDir = path.join(moduleDir, "src", "main", "resources", "META-INF", "spring");
  files.push(writeFile(
    path.join(importsDir, "org.springframework.boot.autoconfigure.AutoConfiguration.imports"),
    `com.orazaka.interceptor.${pkg}.${name}AutoConfiguration\n`,
    workspaceRoot,
    "Spring Boot auto-configuration SPI import",
  ));

  // Test
  files.push(writeFile(
    path.join(srcTest, `${name}InterceptorTest.java`),
    `package com.orazaka.interceptor.${pkg};

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ${name}Interceptor}.
 */
class ${name}InterceptorTest {

    private final ${name}Interceptor interceptor = new ${name}Interceptor();

    @Test
    void shouldReturnCorrectName() {
        assertThat(interceptor.getName()).isEqualTo("${name}Interceptor");
    }

    @Test
    void shouldHavePositiveOrder() {
        assertThat(interceptor.getOrder()).isGreaterThan(0);
    }
}
`,
    workspaceRoot,
    "Unit test for interceptor",
  ));

  return {
    files,
    nextSteps: [
      `Add <module>orazaka-interceptor-${kebab}</module> to orazaka-interceptors/pom.xml`,
      `Add dependency to orazaka-conversation-service/pom.xml: <artifactId>orazaka-interceptor-${kebab}</artifactId>`,
      `Set the correct order in getOrder() per the context-matrix table in AGENTS.md`,
      `Run: mvn clean install -pl orazaka-libs/orazaka-ai-engine/orazaka-interceptors/orazaka-interceptor-${kebab}`,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. Business Feature (full-stack: service + controller + hook)
// ═══════════════════════════════════════════════════════════════

export function generateBusinessFeature(
  ctx: TemplateContext,
  workspaceRoot: string,
): GenerationResult {
  const name = pascalCase(ctx.moduleName);
  const camel = camelCase(ctx.moduleName);
  const kebab = kebabCase(ctx.moduleName);
  const files: GeneratedFile[] = [];

  const struct = scanWorkspaceStructure(workspaceRoot);
  const coreSrc = path.join(struct.coreDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-core"),
    "src", "main", "java", "com", "orazaka", "core");
  const conversationSrc = path.join(struct.conversationDir ?? path.join(workspaceRoot, "orazaka-apps", "services", "orazaka-conversation-service"),
    "src", "main", "java", "com", "orazaka", "router");
  const uiDir = struct.uiDir ?? path.join(workspaceRoot, "orazaka-apps", "ui");

  // Service interface (core)
  files.push(writeFile(
    path.join(coreSrc, "application", "service", `${name}Service.java`),
    `package com.orazaka.core.application.service;

/**
 * ${name}Service: ${ctx.description}
 *
 * @since ${ctx.year}
 */
public interface ${name}Service {

    /**
     * Execute the primary business operation.
     *
     * @param userId the authenticated user ID
     * @param input the request payload
     * @return the result
     */
    String execute(String userId, String input);
}
`,
    workspaceRoot,
    "Service interface (orazaka-core)",
  ));

  // Service implementation (core)
  files.push(writeFile(
    path.join(coreSrc, "application", "service", `${name}ServiceImpl.java`),
    `package com.orazaka.core.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * ${name}ServiceImpl: Implementation of {@link ${name}Service}.
 *
 * @since ${ctx.year}
 */
@Service
final class ${name}ServiceImpl implements ${name}Service {

    private static final Logger log = LoggerFactory.getLogger(${name}ServiceImpl.class);

    @Override
    public String execute(final String userId, final String input) {
        log.info("[${name}] User {} executing with input: {}", userId, input);

        // TODO: Implement business logic
        return "Result: " + input;
    }
}
`,
    workspaceRoot,
    "Service implementation (package-private, orazaka-core)",
  ));

  // REST controller (gateway)
  files.push(writeFile(
    path.join(conversationSrc, "infrastructure", "adapter", "rest", `${name}Controller.java`),
    `package com.orazaka.conversationservice.infrastructure.adapter.rest;

import com.orazaka.core.application.service.${name}Service;
import org.springframework.web.bind.annotation.*;

/**
 * ${name}Controller: REST adapter for ${ctx.description}.
 *
 * @since ${ctx.year}
 */
@RestController
@RequestMapping("/api/v1/${kebab}")
public final class ${name}Controller {

    private final ${name}Service ${camel}Service;

    ${name}Controller(final ${name}Service ${camel}Service) {
        this.${camel}Service = ${camel}Service;
    }

    @PostMapping("/execute")
    public String execute(
            @RequestHeader("X-User-Id") final String userId,
            @RequestBody final String request) {
        return ${camel}Service.execute(userId, request);
    }

    @GetMapping("/health")
    public String health() {
        return "OK";
    }
}
`,
    workspaceRoot,
    "REST controller (orazaka-conversation-service/adapter/rest/)",
  ));

  // React hook (UI)
  const hookName = `use${name}`;
  files.push(writeFile(
    path.join(uiDir, "src", "hooks", `${hookName}.ts`),
    `import { useState, useCallback } from "react";

/**
 * ${hookName}: Client hook for ${ctx.description}
 */
export function ${hookName}() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const execute = useCallback(async (input: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/${kebab}/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        throw new Error(\`HTTP Error: \${response.status}\`);
      }

      const result = await response.json();
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { execute, loading, error, data };
}
`,
    workspaceRoot,
    `React hook (orazaka-ui/src/hooks/${hookName}.ts)`,
  ));

  // Next.js server action (BFF proxy)
  files.push(writeFile(
    path.join(uiDir, "src", "app", "api", kebab, "execute", "route.ts"),
    `import { NextRequest, NextResponse } from "next/server";

/**
 * BFF proxy for ${ctx.description}.
 * Browser never hits Gateway directly (AGENTS.md §6).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const userId = request.headers.get("x-user-id") ?? "anonymous";

    const response = await fetch(\`http://localhost:8080/api/v1/${kebab}/execute\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: \`Gateway error: \${response.statusText}\` },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
`,
    workspaceRoot,
    "Next.js API route (BFF proxy — browser never hits Gateway directly)",
  ));

  return {
    files,
    nextSteps: [
      `Implement business logic in ${name}ServiceImpl.java`,
      `Add request/response DTOs as Java records in orazaka-core`,
      `Write unit tests: ${name}ServiceImplTest.java and ${name}ControllerTest.java`,
      `Start Gateway from IntelliJ, then test: curl -X POST http://localhost:3000/api/${kebab}/execute`,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. Technical Feature (infra-level: config + properties)
// ═══════════════════════════════════════════════════════════════

export function generateTechnicalFeature(
  ctx: TemplateContext,
  workspaceRoot: string,
): GenerationResult {
  const name = pascalCase(ctx.moduleName);
  const kebab = kebabCase(ctx.moduleName);
  const files: GeneratedFile[] = [];

  const struct = scanWorkspaceStructure(workspaceRoot);
  const coreSrc = path.join(struct.coreDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-core"),
    "src", "main", "java", "com", "orazaka", "core");

  // Properties record
  files.push(writeFile(
    path.join(coreSrc, "infrastructure", "config", `${name}Properties.java`),
    `package com.orazaka.core.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * ${name}Properties: Configuration binding for orazaka.${kebab}.* properties.
 *
 * @since ${ctx.year}
 */
@ConfigurationProperties(prefix = "orazaka.${kebab}")
public record ${name}Properties(
    boolean enabled,
    String endpoint,
    int timeoutMs
) {

    public ${name}Properties {
        if (timeoutMs < 0) {
            throw new IllegalArgumentException("timeoutMs must be non-negative");
        }
    }

    /** Defaults. */
    public ${name}Properties() {
        this(true, "http://localhost:8080", 30000);
    }
}
`,
    workspaceRoot,
    "Configuration properties record (self-validating)",
  ));

  // Configuration class
  files.push(writeFile(
    path.join(coreSrc, "infrastructure", "config", `${name}Configuration.java`),
    `package com.orazaka.core.infrastructure.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * ${name}Configuration: Enables ${name}Properties binding.
 *
 * @since ${ctx.year}
 */
@Configuration
@EnableConfigurationProperties(${name}Properties.class)
public class ${name}Configuration {
}
`,
    workspaceRoot,
    "Spring configuration class",
  ));

  // Test
  files.push(writeFile(
    path.join(struct.coreDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-core"),
      "src", "test", "java", "com", "orazaka", "core", "infrastructure", "config", `${name}PropertiesTest.java`),
    `package com.orazaka.core.infrastructure.config;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ${name}PropertiesTest {

    @Test
    void shouldCreateWithDefaults() {
        var props = new ${name}Properties();
        assertThat(props.enabled()).isTrue();
        assertThat(props.endpoint()).isNotBlank();
        assertThat(props.timeoutMs()).isPositive();
    }

    @Test
    void shouldRejectNegativeTimeout() {
        assertThatThrownBy(() -> new ${name}Properties(true, "http://localhost", -1))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
`,
    workspaceRoot,
    "Properties validation test",
  ));

  return {
    files,
    nextSteps: [
      `Add to application.yml: orazaka.${kebab}.enabled=true`,
      `Inject ${name}Properties into services that need this configuration`,
      `Add orazaka.${kebab}.* to docs/GLOSSARY.md environment reference`,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. External API Connector
// ═══════════════════════════════════════════════════════════════

export function generateApiConnector(
  ctx: TemplateContext,
  workspaceRoot: string,
): GenerationResult {
  const name = pascalCase(ctx.moduleName);
  const kebab = kebabCase(ctx.moduleName);
  const files: GeneratedFile[] = [];

  const struct = scanWorkspaceStructure(workspaceRoot);
  const coreSrc = path.join(struct.coreDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-core"),
    "src", "main", "java", "com", "orazaka", "core");

  // Client interface (port)
  files.push(writeFile(
    path.join(coreSrc, "domain", "port", `${name}Client.java`),
    `package com.orazaka.core.domain.port;

/**
 * ${name}Client: Outbound port for ${ctx.description}.
 *
 * <p>Implementations must use Spring RestClient or @HttpExchange proxies
 * (ERR-120: manual HTTP clients are banned).
 *
 * @since ${ctx.year}
 */
public interface ${name}Client {

    /**
     * Call the external API.
     *
     * @param request the request payload
     * @return the response
     */
    String call(String request);

    /**
     * Check if the external service is reachable.
     *
     * @return true if healthy
     */
    boolean isHealthy();
}
`,
    workspaceRoot,
    "Client interface (outbound port)",
  ));

  // RestClient implementation
  files.push(writeFile(
    path.join(coreSrc, "infrastructure", "adapter", "client", `${name}RestClient.java`),
    `package com.orazaka.core.infrastructure.adapter.client;

import com.orazaka.core.domain.port.${name}Client;
import com.orazaka.core.infrastructure.config.${name}ConnectorProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * ${name}RestClient: Spring RestClient adapter for ${ctx.description}.
 *
 * <p>Enforces ERR-120: uses Spring RestClient, no manual HTTP clients.
 *
 * @since ${ctx.year}
 */
@Component
final class ${name}RestClient implements ${name}Client {

    private static final Logger log = LoggerFactory.getLogger(${name}RestClient.class);
    private final RestClient restClient;

    ${name}RestClient(final ${name}ConnectorProperties properties) {
        this.restClient = RestClient.builder()
                .baseUrl(properties.baseUrl())
                .build();
    }

    @Override
    public String call(final String request) {
        log.debug("[${name}] Calling external API");
        return restClient.post()
                .uri("/api/execute")
                .body(request)
                .retrieve()
                .body(String.class);
    }

    @Override
    public boolean isHealthy() {
        try {
            restClient.get()
                    .uri("/health")
                    .retrieve()
                    .toBodilessEntity();
            return true;
        } catch (Exception e) {
            log.warn("[${name}] Health check failed: {}", e.getMessage());
            return false;
        }
    }
}
`,
    workspaceRoot,
    "RestClient adapter (ERR-120 compliant)",
  ));

  // Properties
  files.push(writeFile(
    path.join(coreSrc, "infrastructure", "config", `${name}ConnectorProperties.java`),
    `package com.orazaka.core.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * ${name}ConnectorProperties: Connection settings for ${ctx.description}.
 *
 * @since ${ctx.year}
 */
@ConfigurationProperties(prefix = "orazaka.connector.${kebab}")
public record ${name}ConnectorProperties(
    String baseUrl,
    int timeoutMs,
    int maxRetries
) {

    public ${name}ConnectorProperties {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalArgumentException("baseUrl must not be blank");
        }
    }
}
`,
    workspaceRoot,
    "Connector configuration properties",
  ));

  // Test
  files.push(writeFile(
    path.join(struct.coreDir ?? path.join(workspaceRoot, "orazaka-libs", "orazaka-core"),
      "src", "test", "java", "com", "orazaka", "core", "infrastructure", "adapter", "client", `${name}RestClientTest.java`),
    `package com.orazaka.core.infrastructure.adapter.client;

import com.orazaka.core.infrastructure.config.${name}ConnectorProperties;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class ${name}RestClientTest {

    @Test
    void shouldCreateWithValidProperties() {
        var props = new ${name}ConnectorProperties("http://localhost:9090", 5000, 3);
        var client = new ${name}RestClient(props);
        assertThat(client).isNotNull();
    }
}
`,
    workspaceRoot,
    "RestClient unit test",
  ));

  return {
    files,
    nextSteps: [
      `Add to application.yml: orazaka.connector.${kebab}.base-url=https://api.example.com`,
      `Add env vars to .env: ${kebab.toUpperCase().replace(/-/g, "_")}_BASE_URL, ${kebab.toUpperCase().replace(/-/g, "_")}_API_KEY`,
      `Wire ${name}Client into your service layer`,
      `Run: npx orazaka config to add the new env vars interactively`,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// 5. Configuration / Env Var Module
// ═══════════════════════════════════════════════════════════════

export function generateConfiguration(
  ctx: TemplateContext,
  workspaceRoot: string,
): GenerationResult {
  const name = pascalCase(ctx.moduleName);
  const kebab = kebabCase(ctx.moduleName);
  const envPrefix = kebab.toUpperCase().replace(/-/g, "_");
  const files: GeneratedFile[] = [];

  // Add to .env
  const envFile = path.join(workspaceRoot, ".env");
  if (fs.existsSync(envFile)) {
    let content = fs.readFileSync(envFile, "utf-8");
    const newVars = [
      "",
      `# ─── ${name} Configuration ────────────────────────────`,
      `${envPrefix}_ENABLED=true`,
      `${envPrefix}_ENDPOINT=http://localhost:8080`,
      `${envPrefix}_TIMEOUT_MS=30000`,
    ].join("\n");

    if (!content.includes(`${envPrefix}_ENABLED`)) {
      content += "\n" + newVars + "\n";
      fs.writeFileSync(envFile, content, "utf-8");
      files.push({
        path: envFile,
        relativePath: ".env",
        action: "updated",
        description: `Added ${envPrefix}_* environment variables`,
      });
    } else {
      files.push({
        path: envFile,
        relativePath: ".env",
        action: "skipped",
        description: `${envPrefix}_* already exists in .env`,
      });
    }
  }

  // Add to example env
  const exampleEnv = path.join(workspaceRoot, "exemple.env.txt");
  if (fs.existsSync(exampleEnv)) {
    let content = fs.readFileSync(exampleEnv, "utf-8");
    if (!content.includes(`${envPrefix}_ENABLED`)) {
      content += `\n# ${name}\n${envPrefix}_ENABLED=true\n${envPrefix}_ENDPOINT=http://localhost:8080\n${envPrefix}_TIMEOUT_MS=30000\n`;
      fs.writeFileSync(exampleEnv, content, "utf-8");
      files.push({
        path: exampleEnv,
        relativePath: "exemple.env.txt",
        action: "updated",
        description: "Added variables to env template",
      });
    }
  }

  // Generate Properties class
  const techResult = generateTechnicalFeature(ctx, workspaceRoot);
  files.push(...techResult.files);

  return {
    files,
    nextSteps: [
      `Review and customize the values in .env`,
      `Add to config.command.ts CONFIG_CATEGORIES for interactive editing`,
      ...techResult.nextSteps,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// Existing Templates (preserved)
// ═══════════════════════════════════════════════════════════════

export function generateJavaService(ctx: TemplateContext): { interface: string; implementation: string } {
  const className = `${pascalCase(ctx.moduleName)}Service`;
  const implClassName = `${className}Impl`;

  return {
    interface: `package com.orazaka.core.application.service;

/**
 * ${className}: ${ctx.description}
 *
 * @since ${ctx.year}
 */
public interface ${className} {

    String execute(String input);
}
`,
    implementation: `package com.orazaka.core.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * ${implClassName}: Implementation of ${className}.
 *
 * @since ${ctx.year}
 */
@Service
final class ${implClassName} implements ${className} {

    private static final Logger log = LoggerFactory.getLogger(${implClassName}.class);

    @Override
    public String execute(final String input) {
        log.info("Executing {} with input: {}", "${className}", input);

        // TODO: Implement business logic
        return "Result: " + input;
    }
}
`,
  };
}

export function generateJavaController(ctx: TemplateContext): string {
  const controllerName = `${pascalCase(ctx.moduleName)}Controller`;
  const serviceName = `${pascalCase(ctx.moduleName)}Service`;
  const serviceVarName = camelCase(ctx.moduleName);
  const endpoint = `/${kebabCase(ctx.moduleName)}`;

  return `package com.orazaka.conversationservice.infrastructure.adapter.rest;

import com.orazaka.core.application.service.${serviceName};
import org.springframework.web.bind.annotation.*;

/**
 * ${controllerName}: REST API for ${ctx.description}.
 *
 * @since ${ctx.year}
 */
@RestController
@RequestMapping("${endpoint}")
public final class ${controllerName} {

    private final ${serviceName} ${serviceVarName}Service;

    ${controllerName}(final ${serviceName} ${serviceVarName}Service) {
        this.${serviceVarName}Service = ${serviceVarName}Service;
    }

    @PostMapping("/execute")
    public String execute(@RequestBody final String request) {
        return ${serviceVarName}Service.execute(request);
    }

    @GetMapping("/health")
    public String health() {
        return "OK";
    }
}
`;
}

export function generateTypeScriptHook(ctx: TemplateContext): string {
  const hookName = `use${pascalCase(ctx.moduleName)}`;
  const endpoint = `/${kebabCase(ctx.moduleName)}`;

  return `import { useState, useCallback } from "react";

export function ${hookName}() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const execute = useCallback(async (input: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("${endpoint}/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (!response.ok) throw new Error(\`HTTP Error: \${response.status}\`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  return { execute, loading, error, data };
}
`;
}

export function generateSqlMigration(ctx: TemplateContext): string {
  const tableName = kebabCase(ctx.moduleName).replace(/-/g, "_");
  return `-- Migration: Create ${tableName} table
-- Author: Orazaka | Date: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS ${tableName} (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    name VARCHAR(255) NOT NULL,
    CONSTRAINT ${tableName}_unique_name UNIQUE (name)
);

CREATE INDEX idx_${tableName}_created_at ON ${tableName}(created_at DESC);
`;
}

export function generateDockerComposeService(ctx: TemplateContext): string {
  const serviceName = kebabCase(ctx.moduleName);
  return `  ${serviceName}:
    image: node:24-slim
    container_name: orazaka-${serviceName}
    working_dir: /app
    ports:
      - "3000:3000"
    volumes:
      - ./${serviceName}:/app
    command: npm run start
    restart: unless-stopped
    networks:
      - orazaka-network
`;
}

/** All available template types. */
export type TemplateType =
  | "interceptor"
  | "business-feature"
  | "technical-feature"
  | "api-connector"
  | "configuration"
  | "java-service"
  | "java-controller"
  | "typescript-hook"
  | "sql-migration"
  | "docker-compose";
