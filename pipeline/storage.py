import hashlib
import os
from pathlib import Path


class LocalStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def put(self, key: str, data: bytes) -> str:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return sha256(data)

    def get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()

    def exists(self, key: str) -> bool:
        return (self.root / key).exists()


class S3Store:
    def __init__(self, bucket: str, prefix: str = ""):
        import boto3

        self.bucket, self.prefix, self.client = bucket, prefix.strip("/"), boto3.client("s3")

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}".strip("/")

    def put(self, key: str, data: bytes) -> str:
        self.client.put_object(
            Bucket=self.bucket, Key=self._key(key), Body=data, ServerSideEncryption="AES256"
        )
        return sha256(data)

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=self._key(key))["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except self.client.exceptions.ClientError:
            return False


def make_store(root: str | Path):
    if os.getenv("STORE", "local").lower() == "s3":
        bucket = os.environ["S3_BUCKET"]
        return S3Store(bucket, os.getenv("S3_PREFIX", ""))
    return LocalStore(root)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
