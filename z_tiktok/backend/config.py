"""Application configuration loaded from environment / .env file."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql://tiktokdb2_user:4JyTSwS1gxcwPSzt6K1STJm3vasnQ9hq@dpg-d92c4r4vikkc7386p3n0-a/tiktokdb2"
    SECRET_KEY: str = "njdfhju99-sdfhj$-asjdfnj#lnksdf008"
    SESSION_EXPIRE_HOURS: int = 24
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "strict"
    ADMIN_USERNAME: str = "banana"
    ADMIN_PASSWORD: str = "adminlikesbanana"
    ADMIN_API_TOKEN: str = ""
    CORS_ORIGINS: str = "http://localhost:8000,http://127.0.0.1:8000"
    STATIC_DIR: str = "../"


settings = Settings()
