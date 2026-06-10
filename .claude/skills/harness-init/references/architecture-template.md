# Architecture Template

## 分层架构

```
Types → Config → Repo → Service → Runtime → UI
                         ↑
                    Providers（认证、连接器、遥测、功能标志）
```

### 层次说明

| 层 | 职责 | 允许依赖 |
|----|------|----------|
| Types | 类型定义、接口、枚举 | 无 |
| Config | 配置、环境变量、常量 | Types |
| Repo | 数据访问层、数据库操作 | Types, Config |
| Service | 业务逻辑 | Types, Config, Repo |
| Runtime | 运行时逻辑、中间件 | Types, Config, Repo, Service |
| UI | 用户界面 | 所有层 |
| Providers | 横切关注点入口 | Types, Config |

### 横切关注点

- 认证（Authentication）
- 连接器（Connectors）
- 遥测（Telemetry）
- 功能标志（Feature Flags）

这些关注点通过 `Providers` 接口进入，不允许直接依赖具体实现。

## 约束执行

### Linter 规则示例

```json
{
  "rules": {
    "no-cross-layer-deps": {
      "description": "禁止跨层直接依赖",
      "severity": "error"
    },
    "providers-only-cross-cutting": {
      "description": "横切关注点只通过 Providers 进入",
      "severity": "error"
    }
  }
}
```

### 结构测试示例

```typescript
describe('Architecture boundaries', () => {
  it('Types layer has no dependencies', () => {
    const typesFiles = glob.sync('src/**/types/**/*.ts');
    typesFiles.forEach(file => {
      const imports = getImports(file);
      imports.forEach(imp => {
        expect(imp.source).not.toMatch(/\/(config|repo|service|runtime|ui)\//);
      });
    });
  });
});
```
