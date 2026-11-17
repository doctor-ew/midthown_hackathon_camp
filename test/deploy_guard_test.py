"""Offline release-safety regressions. No AWS credentials or network calls."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('deploy_guard', Path(__file__).resolve().parents[1] / 'scripts/deploy-security-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def archive(handler):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        z.writestr(guard.GUARD, 'old guard')
        z.writestr('dist/src/handler.js', handler)
    return data.getvalue()


class AWS:
    def __init__(self):
        self.packages = {name: archive('CURRENT-' + name) for name in guard.FUNCTIONS}
        self.revisions = {name: 1 for name in guard.FUNCTIONS}
        self.objects = {}
        self.updates = []
        self.invocations = []
        self.fail_on = None
        self.concurrent_on = None
        self.originals = dict(self.packages)

    def config(self, name):
        return {'Handler': 'dist/src/handler.handler', 'Runtime': 'nodejs24.x',
                'RevisionId': str(self.revisions[name]), 'CodeSha256': guard.digest(self.packages[name]),
                'LastUpdateStatus': 'Successful'}

    def get_function(self, FunctionName):
        return {'Configuration': self.config(FunctionName), 'Code': {'Location': FunctionName}}

    def get_function_configuration(self, FunctionName):
        return self.config(FunctionName)

    def put_object(self, **kwargs):
        self.objects[kwargs['Key']] = kwargs['Body']

    def update_function_code(self, FunctionName, RevisionId, **kwargs):
        if RevisionId != str(self.revisions[FunctionName]):
            raise RuntimeError('Revision conflict')
        self.packages[FunctionName] = self.objects[kwargs['S3Key']]
        self.revisions[FunctionName] += 1
        self.updates.append(FunctionName)

    def get_waiter(self, name):
        return self

    def wait(self, **kwargs):
        pass

    def invoke(self, FunctionName, Payload):
        self.invocations.append(FunctionName)
        event = json.loads(Payload)
        if event['body'] != '{}':
            raise RuntimeError('Smoke must not send paid requests')
        if FunctionName == self.fail_on and self.packages[FunctionName] != self.originals[FunctionName]:
            if self.concurrent_on:
                self.packages[FunctionName] = archive('THIRD-PARTY')
                self.revisions[FunctionName] += 1
            return {'StatusCode': 200, 'FunctionError': 'Unhandled', 'Payload': io.BytesIO(b'{}')}
        return {'StatusCode': 200, 'Payload': io.BytesIO(json.dumps({'statusCode': 403,
                'body': json.dumps({'error': 'Please complete the verification and try again.'})}).encode())}


class ReleaseTests(unittest.TestCase):
    def prepare(self, aws, parent):
        run = guard.private_run_directory(parent)
        return guard.prepare(aws, b'new guard', run, lambda url: aws.packages[url]), run

    def test_old_backup_cannot_become_release_preimage(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp, guard.FUNCTIONS[0] + '.zip')
            old.write_bytes(archive('STALE'))
            aws = AWS()
            plans, run = self.prepare(aws, tmp)
            for plan in plans:
                contents = zipfile.ZipFile(io.BytesIO(plan['patched']))
                self.assertEqual(contents.read('dist/src/handler.js'), ('CURRENT-' + plan['name']).encode())
            self.assertEqual(old.read_bytes(), archive('STALE'))
            self.assertNotEqual(run, Path(tmp))

    def test_backups_are_immutable_and_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS()
            _, first = self.prepare(aws, tmp)
            _, second = self.prepare(aws, tmp)
            self.assertNotEqual(first, second)
            self.assertEqual(stat.S_IMODE(first.stat().st_mode), 0o700)
            target = first / (guard.FUNCTIONS[0] + '.json')
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                guard.private_write(target, b'overwrite')

    def test_permissive_and_symlink_backup_paths_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            public = Path(tmp, 'public'); public.mkdir(mode=0o755); public.chmod(0o755)
            link = Path(tmp, 'link'); link.symlink_to(public, target_is_directory=True)
            for path in (public, link):
                with self.assertRaises(RuntimeError):
                    guard.private_run_directory(path)
            dest = Path(tmp, 'dest'); dest.write_bytes(b'original')
            filelink = Path(tmp, 'filelink'); filelink.symlink_to(dest)
            with self.assertRaises(FileExistsError):
                guard.private_write(filelink, b'changed')
            self.assertEqual(dest.read_bytes(), b'original')

    def test_hash_mismatch_fails_before_updates(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS()
            with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
                guard.prepare(aws, b'guard', Path(tmp), lambda url: archive('tampered'))
            self.assertEqual(aws.updates, [])

    def test_explicit_checks_survive_optimized_python(self):
        with self.assertRaises(RuntimeError):
            guard.require(False, 'blocked')
        self.assertNotIn('assert ', Path(guard.__file__).read_text())

    def test_sequential_canary_and_each_function_health(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS(); plans, _ = self.prepare(aws, tmp)
            guard.rollout(aws, aws, plans)
            self.assertEqual(aws.updates, guard.FUNCTIONS)
            self.assertEqual(aws.invocations, guard.FUNCTIONS)

    def test_failed_canary_restores_and_stops_remaining_updates(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS(); plans, _ = self.prepare(aws, tmp); aws.fail_on = guard.FUNCTIONS[0]
            with self.assertRaisesRegex(RuntimeError, 'previous packages restored'):
                guard.rollout(aws, aws, plans)
            self.assertEqual(aws.updates, [guard.FUNCTIONS[0]] * 2)
            self.assertEqual(aws.packages, aws.originals)

    def test_later_failure_restores_all_changed_functions(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS(); plans, _ = self.prepare(aws, tmp); aws.fail_on = guard.FUNCTIONS[1]
            with self.assertRaisesRegex(RuntimeError, 'previous packages restored'):
                guard.rollout(aws, aws, plans)
            self.assertEqual(aws.packages, aws.originals)
            self.assertNotIn(guard.FUNCTIONS[2], aws.updates)

    def test_concurrent_release_prevents_stale_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS(); plans, _ = self.prepare(aws, tmp); aws.revisions[guard.FUNCTIONS[0]] += 1
            with self.assertRaises(RuntimeError):
                guard.rollout(aws, aws, plans)
            self.assertEqual(aws.updates, [])

    def test_lost_update_response_is_reconciled_and_rolled_back(self):
        class LostResponse(AWS):
            lost = False
            def update_function_code(self, **kwargs):
                super().update_function_code(**kwargs)
                if not self.lost:
                    self.lost = True
                    raise TimeoutError('accepted update; response lost')
        with tempfile.TemporaryDirectory() as tmp:
            aws = LostResponse(); plans, _ = self.prepare(aws, tmp)
            with self.assertRaisesRegex(RuntimeError, 'previous packages restored'):
                guard.rollout(aws, aws, plans)
            self.assertEqual(aws.packages, aws.originals)
            self.assertEqual(aws.updates, [guard.FUNCTIONS[0]] * 2)
            self.assertIn(guard.FUNCTIONS[0], aws.invocations)

    def test_rollback_does_not_overwrite_concurrent_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws = AWS(); plans, _ = self.prepare(aws, tmp)
            aws.fail_on = guard.FUNCTIONS[0]; aws.concurrent_on = True
            with self.assertRaisesRegex(RuntimeError, 'rollback requires attention'):
                guard.rollout(aws, aws, plans)
            self.assertEqual(zipfile.ZipFile(io.BytesIO(aws.packages[guard.FUNCTIONS[0]])).read('dist/src/handler.js'), b'THIRD-PARTY')


if __name__ == '__main__':
    unittest.main()
