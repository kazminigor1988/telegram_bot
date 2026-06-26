import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfig, configSchema } from './schema';

@Injectable()
export class ConfigLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ConfigLoaderService.name);
  private cachedConfig: AppConfig | null = null;

  constructor(private readonly configPath: string = path.resolve(process.cwd(), 'config.json')) {}

  async onModuleInit(): Promise<void> {
    const raw = await fs.readFile(this.configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const resolved = this.resolveEnvPlaceholders(parsed);
    this.cachedConfig = configSchema.parse(resolved);
    this.logger.log(`Config loaded from ${this.configPath}`);
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
