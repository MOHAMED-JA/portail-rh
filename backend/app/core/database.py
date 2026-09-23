"""Session SQLAlchemy et base déclarative."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import DATABASE_URL, EST_SQLITE

if EST_SQLITE:
    # Les tâches de fond utilisent la base depuis d'autres fils d'exécution.
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # PostgreSQL (serveur) : connexions vérifiées avant usage, pour survivre
    # à un redémarrage de la base ou à une coupure réseau.
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
