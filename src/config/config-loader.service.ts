import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ZodError } from 'zod';
import { AppConfig, configSchema } from './schema';

@Injectable()
export class ConfigLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ConfigLoaderService.name);
  private cachedConfig: AppConfig | null = null;
  private configPath = path.resolve(process.cwd(), 'config.json');

  setConfigPath(filePath: string): void {
    this.configPath = filePath;
  }

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    if (this.cachedConfig) {
      return;
    }
    const raw = await fs.readFile(this.configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const resolved = this.resolveEnvPlaceholders(parsed);
    try {
      this.cachedConfig = configSchema.parse(resolved);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(this.formatZodError(error, resolved));
      }
      throw error;
    }
    this.logger.log(`Config loaded from ${this.configPath}`);
  }

  private formatZodError(error: ZodError, source: unknown): string {
    const lines = error.issues.map(issue => {
      const path = issue.path.join('.');
      const received = this.valueAtPath(source, issue.path);
      const receivedStr = JSON.stringify(received);
      return `  • path "${path}": ${issue.message} (received: ${receivedStr})`;
    });
    return `Config validation failed:\n${lines.join('\n')}`;
  }

  private valueAtPath(source: unknown, segments: ReadonlyArray<PropertyKey>): unknown {
    return segments.reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object') {
        return (current as Record<PropertyKey, unknown>)[segment];
      }
      return undefined;
    }, source);
  }

  get(): AppConfig {
    if (!this.cachedConfig) {
      throw new Error('Config not loaded yet — onModuleInit must run first');
    }
    return this.cachedConfig;
  }

  private resolveEnvPlaceholders(value: unknown): unknown {
    if (typeof value === 'string') {
      const match = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value);
      if (match) {
        const envValue = process.env[match[1]];
        if (envValue === undefined) {
          throw new Error(`Environment variable ${match[1]} is not set`);
        }
        return envValue;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.resolveEnvPlaceholders(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, this.resolveEnvPlaceholders(val)]),
      );
    }
    return value;
  }
}
