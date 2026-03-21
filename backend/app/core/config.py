from functools import lru_cache
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    app_name: str = "VASP HITL Agent API"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"
    database_url: str = "sqlite:///./vasp_agent.db"
    allowed_origins: list[str] = ["http://localhost:3000"]
    secret_key: str = "change-me"
    ssh_secret_key: str | None = None
    llm_provider: str = "mock"
    llm_model: str = "gpt-4o-mini"
    log_level: str = "INFO"
    ase_run_root: str = "./ase-runs"
    ase_vasp_command: str | None = None

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
