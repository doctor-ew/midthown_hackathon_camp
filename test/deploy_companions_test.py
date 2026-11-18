"""Offline scope and preimage checks for companion-only updates."""
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile
spec = importlib.util.spec_from_file_location('deploy_companions', Path(__file__).resolve().parents[1] / 'scripts/deploy-companions.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class CompanionDeployment(unittest.TestCase):
    def archive(self, omitted=None, duplicate=False):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as z:
            for name in (*deploy.FILES, deploy.guard.GUARD, 'dist/src/handler.js'):
                if name != omitted:
                    z.writestr(name, 'original-' + name)
            if duplicate:
                z.writestr(deploy.FILES[0], 'duplicate')
        return data.getvalue()

    def test_only_two_files_change(self):
        original = self.archive()
        patched = deploy.patch(original, {name: b'new' for name in deploy.FILES})
        before = zipfile.ZipFile(io.BytesIO(original))
        after = zipfile.ZipFile(io.BytesIO(patched))
        self.assertEqual(before.namelist(), after.namelist())
        for name in before.namelist():
            self.assertEqual(after.read(name), b'new' if name in deploy.FILES else before.read(name))

    def test_missing_duplicate_and_extra_scope_rejected(self):
        replacements = {name: b'new' for name in deploy.FILES}
        for missing in (*deploy.FILES, deploy.guard.GUARD):
            with self.assertRaises(RuntimeError):
                deploy.patch(self.archive(omitted=missing), replacements)
        with self.assertRaises(RuntimeError):
            deploy.patch(self.archive(duplicate=True), replacements)
        with self.assertRaises(RuntimeError):
            deploy.patch(self.archive(), {**replacements, deploy.guard.GUARD: b'unsafe'})


if __name__ == '__main__':
    unittest.main()
