#!/usr/bin/env python3
"""Create (or reset) the admin user from the values in .env / config."""

import sys
from datetime import datetime, timedelta
from pathlib import Path

# Ensure the backend package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from passlib.context import CryptContext

from config import settings
from database import Base, SessionLocal, engine
from models import User

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == settings.ADMIN_USERNAME).first()
        if admin:
            admin.password_hash = pwd_ctx.hash(settings.ADMIN_PASSWORD)
            admin.role = "admin"
            admin.expires_at = datetime.utcnow() + timedelta(days=365 * 10)
            db.commit()
            print(f"Admin user '{settings.ADMIN_USERNAME}' password reset.")
        else:
            admin = User(
                username=settings.ADMIN_USERNAME,
                password_hash=pwd_ctx.hash(settings.ADMIN_PASSWORD),
                role="admin",
                expires_at=datetime.utcnow() + timedelta(days=365 * 10),
            )
            db.add(admin)
            db.commit()
            print(f"Admin user '{settings.ADMIN_USERNAME}' created.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
